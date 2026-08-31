import type { SourceCredentialDocument } from "@rhizome/store-contract";
import { and, count, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import {
  CredentialConnectionError,
  type CredentialedSourceCatalog,
  type CredentialClaimPolicy,
  type CredentialSourceConnector,
  type PreparedCredentialConnection,
  type SourceJsonObject,
} from "../../../ingest/connected-sources/types.ts";
import type { Database, ProviderLeasePool } from "../db/index.ts";
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
import {
  createLocalSourceCredentialCrypto,
  credentialAssociatedData,
  type CredentialClaimFingerprints,
  type CredentialEncryptionKeys,
  type PreparedCredentialSecretSeal,
  type SourceCredentialCrypto,
} from "./source-credential-crypto.ts";
import { CREDENTIAL_FETCH_LOCK_SEED } from "./credential-lease.ts";
import { withProviderRequestDeadline } from "./provider-request-deadline.ts";
import type { ServiceContext } from "./types.ts";

const MILLISECONDS_PER_HOUR = 60 * 60 * 1_000;
const CLAIM_ATTEMPT_LIMIT = 10;
const CLAIM_ATTEMPT_WINDOW_HOURS = 1;
const MAX_PUBLIC_METADATA_BYTES = 16 * 1_024;
const MAX_PUBLIC_METADATA_DEPTH = 8;

interface SourceCredentialServiceContext extends ServiceContext {
  credentialCrypto?: SourceCredentialCrypto;
  credentialEncryptionKey?: Uint8Array;
  credentialEncryptionKeys?: CredentialEncryptionKeys;
  claimStore?: SourceCredentialClaimStore;
  credentialedSources?: CredentialedSourceCatalog;
  providerLeasePool: ProviderLeasePool;
}

type ClaimReservation =
  { kind: "existing"; credential: DbSourceCredential } | { kind: "reserved"; attemptUuid: string };

interface ClaimAttemptAllowance {
  attemptLimit: number;
  ownerUuid: string;
  skillId: string;
  windowHours: number;
}

export interface SourceCredentialClaimStore {
  assertCanAttempt(input: ClaimAttemptAllowance): Promise<void>;
  reserve(input: {
    attemptLimit: number;
    fingerprints: CredentialClaimFingerprints;
    ownerUuid: string;
    skillId: string;
    windowHours: number;
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
  private readonly credentialedSources?: CredentialedSourceCatalog;
  private readonly providerLeasePool: ProviderLeasePool;

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
    this.credentialedSources = context.credentialedSources;
    this.providerLeasePool = context.providerLeasePool;
  }

  async connect(skill: CredentialSourceConnector, input: unknown): Promise<DbSourceCredential> {
    if (this.actor.kind !== "user") throw grantMissing("owner");
    if (skill.connection.mode !== "claim_exchange") {
      throw new Problem(
        422,
        "schema_violation",
        "Connection mode mismatch",
        "This source must be connected through its advertised OAuth flow",
      );
    }

    const skillId = skill.skillId;
    const connectorVersion = skill.manifest.connector_version;
    const claimPolicy = supportedClaimPolicy(skill.connection.claimPolicy);
    let preparedConnection: PreparedCredentialConnection;
    try {
      preparedConnection = skill.connection.prepare(input);
    } catch (error) {
      throw connectionProblem(
        error,
        "The source could not validate the supplied connection details",
      );
    }
    await this.claimStore.assertCanAttempt({
      attemptLimit: CLAIM_ATTEMPT_LIMIT,
      ownerUuid: this.actor.uuid,
      skillId,
      windowHours: CLAIM_ATTEMPT_WINDOW_HOURS,
    });
    const fingerprints = await this.credentialCrypto.fingerprintConnectionClaim(
      skillId,
      preparedConnection.replayKey,
      preparedConnection.fingerprintCompatibility,
    );
    const reservation = await this.claimStore.reserve({
      attemptLimit: CLAIM_ATTEMPT_LIMIT,
      fingerprints,
      ownerUuid: this.actor.uuid,
      skillId,
      windowHours: CLAIM_ATTEMPT_WINDOW_HOURS,
    });
    if (reservation.kind === "existing") return reservation.credential;

    const credentialUuid = uuidv7();
    const associatedData = credentialAssociatedData(credentialUuid, this.actor.uuid, skillId);
    let preparedSeal: PreparedCredentialSecretSeal;
    try {
      // KMS must succeed before the one-time connection claim is submitted. If this fails,
      // removing the untouched reservation makes the same skill claim safely retryable.
      preparedSeal = await this.credentialCrypto.prepareSeal(associatedData);
    } catch (error) {
      await this.claimStore.release({
        attemptUuid: reservation.attemptUuid,
        ownerUuid: this.actor.uuid,
      });
      throw error;
    }

    let acquired: Awaited<ReturnType<typeof preparedConnection.acquire>>;
    try {
      acquired = await preparedConnection.acquire();
    } catch (error) {
      preparedSeal.destroy();
      await this.claimStore
        .fail({
          attemptUuid: reservation.attemptUuid,
          errorCode: connectionErrorCode(error),
          ownerUuid: this.actor.uuid,
          status: connectionFailureStatus(error),
        })
        .catch(() => undefined);
      throw connectionProblem(
        error,
        "The source could not complete the connection request; verify the connection and try again",
      );
    }

    try {
      const publicMetadata = publicMetadataForStorage(acquired.publicMetadata);
      const secret = await preparedSeal.seal(acquired.secret);
      return await this.claimStore.succeed({
        attemptUuid: reservation.attemptUuid,
        ownerUuid: this.actor.uuid,
        credential: {
          uuid: credentialUuid,
          userUuid: this.actor.uuid,
          skillId,
          connectorVersion,
          secret,
          ...(publicMetadata === undefined ? {} : { metadata: publicMetadata }),
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
    const credential = await this.getOwned(credentialUuid);
    if (credential.revokedAt) return;
    const skill = this.credentialedSources?.forInstalledSkillId(credential.skillId);
    if (
      skill?.manifest.connector_version === credential.connectorVersion &&
      skill.connection.mode === "oauth2_pkce"
    ) {
      await this.revokeOAuthCredential(credential, skill.connection.revoke);
      return;
    }
    await this.revokeLocally(credentialUuid);
  }

  private async revokeOAuthCredential(
    credential: DbSourceCredential,
    revokeProvider: ((secret: string, input: { signal: AbortSignal }) => Promise<void>) | undefined,
  ): Promise<void> {
    const connection = await this.providerLeasePool.reserve();
    let leaseHeld = false;
    let currentSecret: Uint8Array | undefined;
    try {
      await connection`begin`;
      try {
        const [locked] = await connection<Array<{ revoked_at: Date | null; secret: Uint8Array }>>`
          select revoked_at, secret
          from source_credentials
          where uuid = ${credential.uuid}
            and user_uuid = ${credential.userUuid}
            and skill_id = ${credential.skillId}
            and connector_version = ${credential.connectorVersion}
          for update
        `;
        if (!locked) throw notFound("Source credential");
        if (locked.revoked_at) {
          await connection`commit`;
          return;
        }
        currentSecret = locked.secret;
        const [lease] = await connection<[{ acquired: boolean }]>`
          select pg_try_advisory_lock(
            hashtextextended(${credential.uuid}::text, ${CREDENTIAL_FETCH_LOCK_SEED}::bigint)
          ) as acquired
        `;
        if (!lease?.acquired) {
          throw new Problem(
            429,
            "rate_limited",
            "Source credential is busy",
            "Wait for the active source request to finish before disconnecting",
          );
        }
        leaseHeld = true;
        await connection`commit`;
      } catch (error) {
        await connection`rollback`;
        throw error;
      }
      let providerFailure: unknown;
      if (revokeProvider) {
        try {
          if (!currentSecret) throw notFound("Source credential");
          const secret = await this.credentialCrypto.open(
            currentSecret,
            credentialAssociatedData(credential.uuid, credential.userUuid, credential.skillId),
          );
          await withProviderRequestDeadline((signal) => revokeProvider(secret, { signal }));
        } catch (error) {
          providerFailure = error;
        }
      }
      await connection`begin`;
      try {
        const [revoked] = await connection<Array<{ uuid: string }>>`
          update source_credentials
          set revoked_at = now()
          where uuid = ${credential.uuid}
            and user_uuid = ${credential.userUuid}
            and revoked_at is null
          returning uuid
        `;
        if (!revoked) throw notFound("Source credential");
        await connection`
          update ingestion_sources
          set revoked_at = now()
          where credential_uuid = ${credential.uuid}
            and owner_uuid = ${credential.userUuid}
            and revoked_at is null
        `;
        await connection`commit`;
      } catch (error) {
        await connection`rollback`;
        throw error;
      }
      if (providerFailure) {
        throw connectionProblem(
          providerFailure,
          "The source provider could not complete the disconnect",
        );
      }
    } finally {
      try {
        if (leaseHeld) await connection`select pg_advisory_unlock_all()`;
      } finally {
        connection.release();
      }
    }
  }

  private async revokeLocally(credentialUuid: string): Promise<void> {
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

  async assertCanAttempt(input: ClaimAttemptAllowance): Promise<void> {
    const [owner] = await this.db
      .select({ uuid: users.uuid })
      .from(users)
      .where(eq(users.uuid, input.ownerUuid))
      .limit(1);
    if (!owner) throw notFound("User");

    const windowStart = claimWindowStart(input.windowHours);
    const [recent] = await this.db
      .select({ value: count() })
      .from(sourceCredentialClaimAttempts)
      .where(
        and(
          eq(sourceCredentialClaimAttempts.userUuid, input.ownerUuid),
          eq(sourceCredentialClaimAttempts.skillId, input.skillId),
          gte(sourceCredentialClaimAttempts.createdAt, windowStart),
        ),
      );
    assertClaimAttemptAllowance(recent?.value ?? 0, input.attemptLimit);
  }

  reserve(input: {
    attemptLimit: number;
    fingerprints: CredentialClaimFingerprints;
    ownerUuid: string;
    skillId: string;
    windowHours: number;
  }): Promise<ClaimReservation> {
    return this.db.transaction(async (transaction) => {
      // Lock every fingerprint in a stable order. Retaining old keyring entries means a
      // rolling key rotation still shares at least one lock and cannot double-claim.
      for (const fingerprint of [...input.fingerprints.all].sort()) {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${input.skillId}:${fingerprint}`}, 0))`,
        );
      }

      const [fingerprintAlias] = await transaction
        .select({ attemptUuid: sourceCredentialClaimFingerprints.attemptUuid })
        .from(sourceCredentialClaimFingerprints)
        .where(
          and(
            eq(sourceCredentialClaimFingerprints.skillId, input.skillId),
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
                eq(sourceCredentialClaimAttempts.skillId, input.skillId),
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

      const windowStart = claimWindowStart(input.windowHours);
      const [recent] = await transaction
        .select({ value: count() })
        .from(sourceCredentialClaimAttempts)
        .where(
          and(
            eq(sourceCredentialClaimAttempts.userUuid, input.ownerUuid),
            eq(sourceCredentialClaimAttempts.skillId, input.skillId),
            gte(sourceCredentialClaimAttempts.createdAt, windowStart),
          ),
        );
      assertClaimAttemptAllowance(recent?.value ?? 0, input.attemptLimit);

      const attemptUuid = uuidv7();
      await transaction.insert(sourceCredentialClaimAttempts).values({
        uuid: attemptUuid,
        userUuid: input.ownerUuid,
        skillId: input.skillId,
        tokenFingerprint: input.fingerprints.active,
      });
      await transaction.insert(sourceCredentialClaimFingerprints).values(
        [...new Set(input.fingerprints.all)].map((fingerprint) => ({
          skillId: input.skillId,
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

function assertClaimAttemptAllowance(recentAttemptCount: number, attemptLimit: number): void {
  if (recentAttemptCount < attemptLimit) return;
  throw new Problem(
    429,
    "rate_limited",
    "Too many connection attempts",
    "Wait before submitting another source connection",
  );
}

function supportedClaimPolicy(value: unknown): CredentialClaimPolicy {
  const kind = (value as { kind?: unknown } | undefined)?.kind;
  if (!value || typeof value !== "object" || Array.isArray(value) || kind !== "single_use_global") {
    throw new Error("Credential source has an unsupported claim policy");
  }
  return Object.freeze({ kind });
}

function claimWindowStart(windowHours: number): Date {
  if (!boundedInteger(windowHours, 1, 720)) {
    throw new Error("Credential claim window must be between 1 and 720 hours");
  }
  return new Date(Date.now() - windowHours * MILLISECONDS_PER_HOUR);
}

export function publicMetadataForStorage(value: unknown): SourceJsonObject | undefined {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) {
    throw new Error("Credential public metadata must be a JSON object");
  }
  assertPublicMetadataValue(value, 0, new Set<object>());
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).byteLength > MAX_PUBLIC_METADATA_BYTES) {
    throw new Error(`Credential public metadata exceeds ${MAX_PUBLIC_METADATA_BYTES} bytes`);
  }
  return JSON.parse(encoded) as SourceJsonObject;
}

function assertPublicMetadataValue(value: unknown, depth: number, ancestors: Set<object>): void {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (!value || typeof value !== "object" || depth >= MAX_PUBLIC_METADATA_DEPTH) {
    throw new Error("Credential public metadata must contain bounded JSON values");
  }
  if (ancestors.has(value)) {
    throw new Error("Credential public metadata must not contain cycles");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Object.keys(value);
      if (
        keys.length !== value.length ||
        keys.some((key, index) => key !== String(index)) ||
        Object.getOwnPropertySymbols(value).length > 0
      ) {
        throw new Error("Credential public metadata arrays must contain only JSON values");
      }
      for (const entry of value) assertPublicMetadataValue(entry, depth + 1, ancestors);
      return;
    }
    if (!isPlainRecord(value)) {
      throw new Error("Credential public metadata must contain only JSON objects");
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        throw new Error("Credential public metadata keys must be strings");
      }
      assertPublicMetadataKey(key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new Error("Credential public metadata must contain plain JSON properties");
      }
      assertPublicMetadataValue(descriptor.value, depth + 1, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function assertPublicMetadataKey(key: string): void {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
  if (
    ["token", "secret", "password", "credential", "authorizationcode", "codeverifier"].some(
      (sensitive) => normalized.includes(sensitive),
    )
  ) {
    throw new Error("Credential public metadata must not contain sensitive fields");
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return (
    Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
  );
}

function consumedClaimProblem(): Problem {
  return new Problem(
    422,
    "source_connection_failed",
    "Source connection failed",
    "These one-time connection details were already submitted and cannot be used again. If the earlier result is unavailable, disable them before creating another connection",
  );
}

export function connectionFailureStatus(
  error: unknown,
): Extract<SourceCredentialClaimStatus, "ambiguous" | "rejected"> {
  return error instanceof CredentialConnectionError ? error.disposition : "ambiguous";
}

export function connectionErrorCode(error: unknown): string {
  return error instanceof CredentialConnectionError && /^[a-z][a-z0-9_]{0,63}$/u.test(error.code)
    ? error.code
    : "connection_acquire_failed";
}

export function connectionProblem(error: unknown, fallbackDetail: string): Problem {
  return new Problem(
    422,
    "source_connection_failed",
    "Source connection failed",
    error instanceof CredentialConnectionError ? error.message : fallbackDetail,
  );
}

export function serializeSourceCredential(
  credential: DbSourceCredential,
): SourceCredentialDocument {
  return {
    credential: `credential:${credential.uuid}`,
    skill_id: credential.skillId,
    connector_version: credential.connectorVersion,
    status: credential.revokedAt ? "revoked" : "active",
    connected_at: credential.connectedAt.toISOString(),
    ...(credential.revokedAt ? { revoked_at: credential.revokedAt.toISOString() } : {}),
  };
}
