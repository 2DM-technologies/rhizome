import type { ConnectSimpleFinRequest, SourceCredentialDocument } from "@rhizome/store-contract";
import { SIMPLEFIN_PROVIDER } from "@rhizome/store-contract";
import { and, count, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { Database } from "../db/index.ts";
import {
  sourceCredentialClaimAttempts,
  type SourceCredentialClaimStatus,
} from "../db/models/source-credential-claim-attempt.ts";
import { sourceCredentialClaimFingerprints } from "../db/models/source-credential-claim-fingerprint.ts";
import {
  sourceCredentials,
  type DbSourceCredential,
  type NewDbSourceCredential,
} from "../db/models/source-credential.ts";
import { ingestionSources } from "../db/models/ingestion-source.ts";
import { users } from "../db/models/user.ts";
import { grantMissing, notFound, Problem } from "../errors.ts";
import { SimpleFinClientError } from "./simplefin-client.ts";
import {
  createLocalSourceCredentialCrypto,
  credentialAssociatedData,
  type CredentialEncryptionKeys,
  type CredentialTokenFingerprints,
  type PreparedCredentialSecretSeal,
  type SourceCredentialCrypto,
} from "./source-credential-crypto.ts";
import type { ServiceContext } from "./types.ts";

const CLAIM_ATTEMPT_LIMIT = 10;
const CLAIM_ATTEMPT_WINDOW_MS = 60 * 60 * 1_000;

export interface SimpleFinTokenExchange {
  canonicalizeSetupToken(setupToken: string): string;
  claimSetupToken(setupToken: string): Promise<string>;
}

interface SourceCredentialServiceContext extends ServiceContext {
  credentialCrypto?: SourceCredentialCrypto;
  credentialEncryptionKey?: Uint8Array;
  credentialEncryptionKeys?: CredentialEncryptionKeys;
  claimStore?: SourceCredentialClaimStore;
  simpleFin: SimpleFinTokenExchange;
}

type ClaimReservation =
  { kind: "existing"; credential: DbSourceCredential } | { kind: "reserved"; attemptUuid: string };

export interface SourceCredentialClaimStore {
  assertCanAttempt(input: { ownerUuid: string; provider: string }): Promise<void>;
  reserve(input: {
    fingerprints: CredentialTokenFingerprints;
    ownerUuid: string;
    provider: string;
  }): Promise<ClaimReservation>;
  fail(input: {
    attemptUuid: string;
    errorCode: string;
    ownerUuid: string;
    status: Extract<SourceCredentialClaimStatus, "ambiguous" | "rejected">;
  }): Promise<void>;
  release(input: { attemptUuid: string; ownerUuid: string }): Promise<void>;
  succeed(input: {
    attemptUuid: string;
    credential: NewDbSourceCredential;
    ownerUuid: string;
  }): Promise<DbSourceCredential>;
}

export class SourceCredentialsService {
  private readonly db: Database;
  private readonly actor: ServiceContext["actor"];
  private readonly credentialCrypto: SourceCredentialCrypto;
  private readonly claimStore: SourceCredentialClaimStore;
  private readonly simpleFin: SimpleFinTokenExchange;

  constructor(context: SourceCredentialServiceContext) {
    this.db = context.db;
    this.actor = context.actor;
    const credentialEncryptionKeys =
      context.credentialEncryptionKeys ?? context.credentialEncryptionKey;
    if (!context.credentialCrypto && !credentialEncryptionKeys) {
      throw new Error("Credential crypto is required");
    }
    this.credentialCrypto =
      context.credentialCrypto ?? createLocalSourceCredentialCrypto(credentialEncryptionKeys!);
    this.claimStore = context.claimStore ?? new DatabaseSourceCredentialClaimStore(context.db);
    this.simpleFin = context.simpleFin;
  }

  async connectSimpleFin(input: ConnectSimpleFinRequest): Promise<DbSourceCredential> {
    if (this.actor.kind !== "user") throw grantMissing("owner");

    const provider = SIMPLEFIN_PROVIDER;
    let claimTarget: string;
    try {
      claimTarget = this.simpleFin.canonicalizeSetupToken(input.setup_token);
    } catch (error) {
      const detail =
        error instanceof SimpleFinClientError
          ? error.message
          : "SimpleFIN could not validate this setup token";
      throw new Problem(422, "source_connection_failed", "SimpleFIN connection failed", detail);
    }
    await this.claimStore.assertCanAttempt({ ownerUuid: this.actor.uuid, provider });
    const fingerprints = await this.credentialCrypto.fingerprintSetupToken(claimTarget);
    const reservation = await this.claimStore.reserve({
      fingerprints,
      ownerUuid: this.actor.uuid,
      provider,
    });
    if (reservation.kind === "existing") return reservation.credential;

    const credentialUuid = uuidv7();
    const associatedData = credentialAssociatedData(credentialUuid, this.actor.uuid, provider);
    let preparedSeal: PreparedCredentialSecretSeal;
    try {
      // KMS must succeed before the one-time setup token is submitted. If this fails, removing
      // the untouched reservation makes the same provider token safely retryable.
      preparedSeal = await this.credentialCrypto.prepareSeal(associatedData);
    } catch (error) {
      await this.claimStore.release({
        attemptUuid: reservation.attemptUuid,
        ownerUuid: this.actor.uuid,
      });
      throw error;
    }

    let accessUrl: string;
    try {
      accessUrl = await this.simpleFin.claimSetupToken(input.setup_token);
    } catch (error) {
      preparedSeal.destroy();
      await this.claimStore
        .fail({
          attemptUuid: reservation.attemptUuid,
          errorCode: claimErrorCode(error),
          ownerUuid: this.actor.uuid,
          status: claimFailureStatus(error),
        })
        .catch(() => undefined);
      const detail =
        error instanceof SimpleFinClientError
          ? error.message
          : "SimpleFIN could not exchange this setup token; verify the connection and try again";
      throw new Problem(422, "source_connection_failed", "SimpleFIN connection failed", detail);
    }

    try {
      const secret = await preparedSeal.seal(accessUrl);
      return await this.claimStore.succeed({
        attemptUuid: reservation.attemptUuid,
        ownerUuid: this.actor.uuid,
        credential: {
          uuid: credentialUuid,
          userUuid: this.actor.uuid,
          provider,
          secret,
        },
      });
    } catch (error) {
      await this.claimStore
        .fail({
          attemptUuid: reservation.attemptUuid,
          errorCode: "credential_persist_failed",
          ownerUuid: this.actor.uuid,
          status: "ambiguous",
        })
        .catch(() => undefined);
      throw error;
    } finally {
      preparedSeal.destroy();
    }
  }

  async getOwned(credentialUuid: string): Promise<DbSourceCredential> {
    if (this.actor.kind !== "user") throw grantMissing("owner");
    const credential = await this.db.query.sourceCredentials.findFirst({
      where: and(
        eq(sourceCredentials.uuid, credentialUuid),
        eq(sourceCredentials.userUuid, this.actor.uuid),
      ),
    });
    if (!credential) throw notFound("Source credential");
    return credential;
  }

  async revoke(credentialUuid: string): Promise<void> {
    if (this.actor.kind !== "user") throw grantMissing("owner");
    const ownerUuid = this.actor.uuid;
    await this.db.transaction(async (transaction) => {
      const [credential] = await transaction
        .select()
        .from(sourceCredentials)
        .where(
          and(
            eq(sourceCredentials.uuid, credentialUuid),
            eq(sourceCredentials.userUuid, ownerUuid),
          ),
        )
        .for("update");
      if (!credential) throw notFound("Source credential");

      const revokedAt = credential.revokedAt ?? new Date();
      if (!credential.revokedAt) {
        const [revoked] = await transaction
          .update(sourceCredentials)
          .set({ revokedAt })
          .where(
            and(
              eq(sourceCredentials.uuid, credentialUuid),
              eq(sourceCredentials.userUuid, ownerUuid),
              isNull(sourceCredentials.revokedAt),
            ),
          )
          .returning({ uuid: sourceCredentials.uuid });
        if (!revoked) throw notFound("Source credential");
      }
      // An active source must never outlive the credential that authorizes it.
      await transaction
        .update(ingestionSources)
        .set({ revokedAt })
        .where(
          and(
            eq(ingestionSources.credentialUuid, credentialUuid),
            eq(ingestionSources.ownerUuid, ownerUuid),
            isNull(ingestionSources.revokedAt),
          ),
        );
    });
  }
}

class DatabaseSourceCredentialClaimStore implements SourceCredentialClaimStore {
  constructor(private readonly db: Database) {}

  async assertCanAttempt(input: { ownerUuid: string; provider: string }): Promise<void> {
    const [owner] = await this.db
      .select({ uuid: users.uuid })
      .from(users)
      .where(eq(users.uuid, input.ownerUuid))
      .limit(1);
    if (!owner) throw notFound("User");

    const windowStart = new Date(Date.now() - CLAIM_ATTEMPT_WINDOW_MS);
    const [recent] = await this.db
      .select({ value: count() })
      .from(sourceCredentialClaimAttempts)
      .where(
        and(
          eq(sourceCredentialClaimAttempts.userUuid, input.ownerUuid),
          eq(sourceCredentialClaimAttempts.provider, input.provider),
          gte(sourceCredentialClaimAttempts.createdAt, windowStart),
        ),
      );
    assertClaimAttemptAllowance(recent?.value ?? 0);
  }

  reserve(input: {
    fingerprints: CredentialTokenFingerprints;
    ownerUuid: string;
    provider: string;
  }): Promise<ClaimReservation> {
    return this.db.transaction(async (transaction) => {
      // Lock every fingerprint in a stable order. Retaining old keyring entries means a
      // rolling key rotation still shares at least one lock and cannot double-claim.
      for (const fingerprint of [...input.fingerprints.all].sort()) {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${input.provider}:${fingerprint}`}, 0))`,
        );
      }

      const [fingerprintAlias] = await transaction
        .select({ attemptUuid: sourceCredentialClaimFingerprints.attemptUuid })
        .from(sourceCredentialClaimFingerprints)
        .where(
          and(
            eq(sourceCredentialClaimFingerprints.provider, input.provider),
            inArray(sourceCredentialClaimFingerprints.fingerprint, [...input.fingerprints.all]),
          ),
        )
        .limit(1);
      const [existing] = fingerprintAlias
        ? await transaction
            .select()
            .from(sourceCredentialClaimAttempts)
            .where(eq(sourceCredentialClaimAttempts.uuid, fingerprintAlias.attemptUuid))
            .limit(1)
        : await transaction
            .select()
            .from(sourceCredentialClaimAttempts)
            .where(
              and(
                eq(sourceCredentialClaimAttempts.provider, input.provider),
                inArray(sourceCredentialClaimAttempts.tokenFingerprint, [
                  ...input.fingerprints.all,
                ]),
              ),
            )
            .limit(1);
      if (existing) {
        if (
          existing.userUuid === input.ownerUuid &&
          existing.status === "succeeded" &&
          existing.credentialUuid
        ) {
          const [credential] = await transaction
            .select()
            .from(sourceCredentials)
            .where(
              and(
                eq(sourceCredentials.uuid, existing.credentialUuid),
                eq(sourceCredentials.userUuid, input.ownerUuid),
                isNull(sourceCredentials.revokedAt),
              ),
            )
            .limit(1);
          if (credential) return { kind: "existing", credential };
        }
        throw consumedClaimProblem();
      }

      const [owner] = await transaction
        .select({ uuid: users.uuid })
        .from(users)
        .where(eq(users.uuid, input.ownerUuid))
        .for("update");
      if (!owner) throw notFound("User");

      const windowStart = new Date(Date.now() - CLAIM_ATTEMPT_WINDOW_MS);
      const [recent] = await transaction
        .select({ value: count() })
        .from(sourceCredentialClaimAttempts)
        .where(
          and(
            eq(sourceCredentialClaimAttempts.userUuid, input.ownerUuid),
            eq(sourceCredentialClaimAttempts.provider, input.provider),
            gte(sourceCredentialClaimAttempts.createdAt, windowStart),
          ),
        );
      assertClaimAttemptAllowance(recent?.value ?? 0);

      const attemptUuid = uuidv7();
      await transaction.insert(sourceCredentialClaimAttempts).values({
        uuid: attemptUuid,
        userUuid: input.ownerUuid,
        provider: input.provider,
        tokenFingerprint: input.fingerprints.active,
      });
      await transaction.insert(sourceCredentialClaimFingerprints).values(
        [...new Set(input.fingerprints.all)].map((fingerprint) => ({
          provider: input.provider,
          fingerprint,
          attemptUuid,
        })),
      );
      return { kind: "reserved", attemptUuid };
    });
  }

  async fail(input: {
    attemptUuid: string;
    errorCode: string;
    ownerUuid: string;
    status: Extract<SourceCredentialClaimStatus, "ambiguous" | "rejected">;
  }): Promise<void> {
    await this.db
      .update(sourceCredentialClaimAttempts)
      .set({ status: input.status, errorCode: input.errorCode, updatedAt: new Date() })
      .where(
        and(
          eq(sourceCredentialClaimAttempts.uuid, input.attemptUuid),
          eq(sourceCredentialClaimAttempts.userUuid, input.ownerUuid),
          eq(sourceCredentialClaimAttempts.status, "claiming"),
        ),
      );
  }

  async release(input: { attemptUuid: string; ownerUuid: string }): Promise<void> {
    await this.db
      .delete(sourceCredentialClaimAttempts)
      .where(
        and(
          eq(sourceCredentialClaimAttempts.uuid, input.attemptUuid),
          eq(sourceCredentialClaimAttempts.userUuid, input.ownerUuid),
          eq(sourceCredentialClaimAttempts.status, "claiming"),
        ),
      );
  }

  succeed(input: {
    attemptUuid: string;
    credential: NewDbSourceCredential;
    ownerUuid: string;
  }): Promise<DbSourceCredential> {
    return this.db.transaction(async (transaction) => {
      const [attempt] = await transaction
        .select()
        .from(sourceCredentialClaimAttempts)
        .where(
          and(
            eq(sourceCredentialClaimAttempts.uuid, input.attemptUuid),
            eq(sourceCredentialClaimAttempts.userUuid, input.ownerUuid),
            eq(sourceCredentialClaimAttempts.status, "claiming"),
          ),
        )
        .for("update");
      if (!attempt) throw consumedClaimProblem();

      const [credential] = await transaction
        .insert(sourceCredentials)
        .values(input.credential)
        .returning();
      if (!credential) throw new Error("Source credential insert did not return a row");
      const [completed] = await transaction
        .update(sourceCredentialClaimAttempts)
        .set({
          status: "succeeded",
          credentialUuid: credential.uuid,
          errorCode: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(sourceCredentialClaimAttempts.uuid, input.attemptUuid),
            eq(sourceCredentialClaimAttempts.userUuid, input.ownerUuid),
            eq(sourceCredentialClaimAttempts.status, "claiming"),
          ),
        )
        .returning({ uuid: sourceCredentialClaimAttempts.uuid });
      if (!completed) throw consumedClaimProblem();
      return credential;
    });
  }
}

function assertClaimAttemptAllowance(recentAttemptCount: number): void {
  if (recentAttemptCount < CLAIM_ATTEMPT_LIMIT) return;
  throw new Problem(
    429,
    "rate_limited",
    "Too many connection attempts",
    "Wait before submitting another SimpleFIN setup token",
  );
}

function consumedClaimProblem(): Problem {
  return new Problem(
    422,
    "source_connection_failed",
    "SimpleFIN connection failed",
    "This one-time setup token was already submitted and cannot be claimed again. If the earlier result is unavailable, disable it before creating another token",
  );
}

function claimFailureStatus(
  error: unknown,
): Extract<SourceCredentialClaimStatus, "ambiguous" | "rejected"> {
  return error instanceof SimpleFinClientError &&
    (error.kind === "invalid_setup_token" || error.kind === "claim_rejected")
    ? "rejected"
    : "ambiguous";
}

function claimErrorCode(error: unknown): string {
  return error instanceof SimpleFinClientError ? error.kind : "claim_failed";
}

export function serializeSourceCredential(
  credential: DbSourceCredential,
): SourceCredentialDocument {
  if (credential.provider !== SIMPLEFIN_PROVIDER) {
    throw new Error(`Unsupported source credential provider: ${credential.provider}`);
  }
  return {
    credential: `credential:${credential.uuid}`,
    provider: SIMPLEFIN_PROVIDER,
    status: credential.revokedAt ? "revoked" : "active",
    connected_at: credential.connectedAt.toISOString(),
    ...(credential.revokedAt ? { revoked_at: credential.revokedAt.toISOString() } : {}),
  };
}
