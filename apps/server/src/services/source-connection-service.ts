import type {
  SourceConnectionAttemptDocument,
  SourceConnectionIntent,
  StartSourceConnectionRequest,
  StartSourceConnectionResponse,
} from "@rhizome/store-contract";
import { and, count, eq, gte } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import {
  CredentialConnectionError,
  type CredentialedSourceCatalog,
  type OAuth2PkceConnectionDefinition,
} from "../../../ingest/connected-sources/types.ts";
import type { Database } from "../db/index.ts";
import {
  sourceConnectionAttempts,
  type DbSourceConnectionAttempt,
  type NewDbSourceConnectionAttempt,
  type SourceConnectionAttemptStatus,
} from "../db/models/source-connection-attempt.ts";
import { sourceCredentials, type NewDbSourceCredential } from "../db/models/source-credential.ts";
import { users } from "../db/models/user.ts";
import { vibes } from "../db/models/vibe.ts";
import { grantMissing, notFound, Problem } from "../errors.ts";
import {
  credentialAssociatedData,
  type SourceCredentialCrypto,
} from "./source-credential-crypto.ts";
import { connectionErrorCode, publicMetadataForStorage } from "./source-credential-service.ts";
import { withProviderRequestDeadline } from "./provider-request-deadline.ts";
import type { ServiceContext } from "./types.ts";
import { uriId } from "./uris.ts";

const ATTEMPT_TTL_MILLISECONDS = 10 * 60 * 1_000;
const ATTEMPT_LIMIT = 10;
const ATTEMPT_WINDOW_MILLISECONDS = 60 * 60 * 1_000;
const CALLBACK_PATH = "/rnet/v0/source-connections/oauth/callback";
const MAX_AUTHORIZATION_URL_BYTES = 8_192;

type CallbackInput =
  | { state: string; code: string; error?: never; errorDescription?: never }
  | { state: string; code?: never; error: string; errorDescription?: string };

type ClaimedAttempt =
  | { kind: "claimed"; attempt: DbSourceConnectionAttempt }
  | { kind: "missing" }
  | { kind: "consumed" };

export interface SourceConnectionAttemptStore {
  assertCanCreate(input: {
    attemptLimit: number;
    ownerUuid: string;
    windowStart: Date;
  }): Promise<void>;
  create(
    input: NewDbSourceConnectionAttempt & { attemptLimit: number; windowStart: Date },
  ): Promise<DbSourceConnectionAttempt>;
  claim(input: {
    actorUuid?: string;
    browserBindings: ReadonlyMap<string, string>;
    now: Date;
    stateHash: string;
  }): Promise<ClaimedAttempt>;
  fail(input: {
    attemptUuid: string;
    errorCode: string;
    status: Extract<SourceConnectionAttemptStatus, "failed" | "rejected">;
    now: Date;
  }): Promise<void>;
  getOwned(
    attemptUuid: string,
    ownerUuid: string,
    now: Date,
  ): Promise<DbSourceConnectionAttempt | undefined>;
  succeed(input: {
    attemptUuid: string;
    credential: NewDbSourceCredential;
    now: Date;
  }): Promise<DbSourceConnectionAttempt>;
}

interface SourceConnectionServiceContext extends ServiceContext {
  baseUrl: string;
  allowedReturnOrigins: readonly string[];
  catalog: CredentialedSourceCatalog;
  credentialCrypto: SourceCredentialCrypto;
  now?: () => Date;
  store?: SourceConnectionAttemptStore;
}

export interface StartedSourceConnection {
  attempt: StartSourceConnectionResponse;
  browserBindingCookie: string;
}

export interface CompletedSourceConnection {
  attemptUuid: string;
  returnUrl: string;
}

export class SourceConnectionService {
  private readonly db: Database;
  private readonly actor: ServiceContext["actor"];
  private readonly baseUrl: string;
  private readonly allowedReturnOrigins: ReadonlySet<string>;
  private readonly catalog: CredentialedSourceCatalog;
  private readonly credentialCrypto: SourceCredentialCrypto;
  private readonly now: () => Date;
  private readonly store: SourceConnectionAttemptStore;

  constructor(context: SourceConnectionServiceContext) {
    this.db = context.db;
    this.actor = context.actor;
    this.baseUrl = context.baseUrl.replace(/\/$/u, "");
    this.allowedReturnOrigins = new Set(context.allowedReturnOrigins);
    this.catalog = context.catalog;
    this.credentialCrypto = context.credentialCrypto;
    this.now = context.now ?? (() => new Date());
    this.store = context.store ?? new DatabaseSourceConnectionAttemptStore(context.db);
  }

  async start(
    skillId: string,
    input: StartSourceConnectionRequest,
  ): Promise<StartedSourceConnection> {
    if (this.actor.kind !== "user") throw grantMissing("owner");
    const skill = this.catalog.forSkillId(skillId);
    if (!skill) throw unsupportedSkill(skillId);
    const oauthConnection = skill.connection;
    if (oauthConnection.mode !== "oauth2_pkce") throw connectionModeMismatch();
    await this.assertIntentOwnership(input.intent);
    const returnUrl = approvedReturnUrl(input.return_to, this.allowedReturnOrigins, input.intent);
    const now = this.now();
    const windowStart = new Date(now.getTime() - ATTEMPT_WINDOW_MILLISECONDS);
    await this.store.assertCanCreate({
      attemptLimit: ATTEMPT_LIMIT,
      ownerUuid: this.actor.uuid,
      windowStart,
    });
    const attemptUuid = uuidv7();
    const callbackUrl = `${this.baseUrl}${CALLBACK_PATH}`;
    const state = randomBase64Url(32);
    const browserBinding = randomBase64Url(32);
    const verifier = randomBase64Url(64);
    const codeChallenge = await sha256Base64Url(verifier);
    const stateHash = await oauthStateHash(state);
    const expiresAt = new Date(now.getTime() + ATTEMPT_TTL_MILLISECONDS);
    const verifierSeal = await this.credentialCrypto.prepareSeal(
      oauthVerifierAssociatedData(attemptUuid, this.actor.uuid, skillId),
    );
    let sealedVerifier: Uint8Array;
    try {
      sealedVerifier = await verifierSeal.seal(verifier);
    } finally {
      verifierSeal.destroy();
    }
    const authorizationUrl = validatedAuthorizationUrl(
      oauthConnection,
      { callbackUrl, codeChallenge, state },
      verifier,
    );
    const attempt = await this.store.create({
      uuid: attemptUuid,
      userUuid: this.actor.uuid,
      skillId,
      connectorVersion: skill.manifest.connector_version,
      stateHash,
      browserBindingHash: await sha256Fingerprint(browserBinding),
      verifier: sealedVerifier,
      callbackUrl,
      returnUrl,
      intent: input.intent,
      expiresAt,
      createdAt: now,
      updatedAt: now,
      attemptLimit: ATTEMPT_LIMIT,
      windowStart,
    });
    if (attempt.status !== "pending") {
      throw new Error("A new source connection attempt must be pending");
    }
    return {
      attempt: {
        attempt_id: attempt.uuid,
        authorization_url: authorizationUrl,
        created_at: attempt.createdAt.toISOString(),
        expires_at: attempt.expiresAt.toISOString(),
        intent: attempt.intent as SourceConnectionIntent,
        skill_id: attempt.skillId,
        status: "pending",
      },
      browserBindingCookie: sourceConnectionBindingCookie(
        attempt.uuid,
        browserBinding,
        attempt.callbackUrl,
      ),
    };
  }

  async complete(
    input: CallbackInput,
    cookieHeader: string | undefined,
  ): Promise<CompletedSourceConnection> {
    const stateHash = await oauthStateHash(input.state);
    const claimed = await this.store.claim({
      ...(this.actor.kind === "user" ? { actorUuid: this.actor.uuid } : {}),
      browserBindings: await sourceConnectionBindingHashes(cookieHeader),
      now: this.now(),
      stateHash,
    });
    if (claimed.kind === "missing") throw invalidOAuthCallback();
    if (claimed.kind === "consumed") throw consumedOAuthCallback();
    const attempt = claimed.attempt;
    const skill = this.catalog.forSkillId(attempt.skillId);
    const oauthConnection = skill?.connection;
    if (
      !skill ||
      skill.manifest.connector_version !== attempt.connectorVersion ||
      oauthConnection?.mode !== "oauth2_pkce"
    ) {
      await this.fail(attempt.uuid, "oauth_connector_unavailable", "failed");
      return {
        attemptUuid: attempt.uuid,
        returnUrl: completionUrl(attempt.returnUrl, attempt.uuid),
      };
    }
    if (input.error !== undefined) {
      let providerError: CredentialConnectionError | undefined;
      try {
        providerError = oauthConnection.callbackError?.({
          error: input.error,
          ...(input.errorDescription ? { errorDescription: input.errorDescription } : {}),
        });
      } catch (error) {
        providerError =
          error instanceof CredentialConnectionError
            ? error
            : new CredentialConnectionError(
                "oauth_provider_rejected",
                "ambiguous",
                "The source provider did not complete authorization",
              );
      }
      await this.fail(
        attempt.uuid,
        providerError ? connectionErrorCode(providerError) : "oauth_provider_rejected",
        providerError?.disposition === "ambiguous" ? "failed" : "rejected",
      );
      return {
        attemptUuid: attempt.uuid,
        returnUrl: completionUrl(attempt.returnUrl, attempt.uuid),
      };
    }

    let acquiredSecret: string | undefined;
    let credentialCommitted = false;
    try {
      const verifier = await this.credentialCrypto.open(
        attempt.verifier,
        oauthVerifierAssociatedData(attempt.uuid, attempt.userUuid, attempt.skillId),
      );
      const credentialUuid = uuidv7();
      const credentialSeal = await this.credentialCrypto.prepareSeal(
        credentialAssociatedData(credentialUuid, attempt.userUuid, attempt.skillId),
      );
      try {
        const acquired = await withProviderRequestDeadline((signal) =>
          oauthConnection.exchange({
            callbackUrl: attempt.callbackUrl,
            code: input.code,
            codeVerifier: verifier,
            signal,
          }),
        );
        acquiredSecret = acquired.secret;
        const secret = await credentialSeal.seal(acquired.secret);
        await this.store.succeed({
          attemptUuid: attempt.uuid,
          now: this.now(),
          credential: {
            uuid: credentialUuid,
            userUuid: attempt.userUuid,
            skillId: attempt.skillId,
            connectorVersion: attempt.connectorVersion,
            secret,
            ...(acquired.publicMetadata
              ? { metadata: publicMetadataForStorage(acquired.publicMetadata) }
              : {}),
          },
        });
        credentialCommitted = true;
      } finally {
        credentialSeal.destroy();
      }
    } catch (error) {
      const revoke = oauthConnection.revoke;
      if (
        acquiredSecret &&
        !credentialCommitted &&
        revoke &&
        !(error instanceof AmbiguousCredentialCommitError)
      ) {
        try {
          const secret = acquiredSecret;
          await withProviderRequestDeadline((signal) => revoke(secret, { signal }));
        } catch {
          // The attempt still becomes terminal. Provider cleanup is best effort and never exposed.
        }
      }
      await this.fail(
        attempt.uuid,
        connectionErrorCode(error) === "connection_acquire_failed"
          ? "oauth_exchange_failed"
          : connectionErrorCode(error),
        error instanceof CredentialConnectionError && error.disposition === "rejected"
          ? "rejected"
          : "failed",
      );
    }
    return { attemptUuid: attempt.uuid, returnUrl: completionUrl(attempt.returnUrl, attempt.uuid) };
  }

  async getOwned(attemptUuid: string): Promise<SourceConnectionAttemptDocument> {
    if (this.actor.kind !== "user") throw grantMissing("owner");
    const attempt = await this.store.getOwned(attemptUuid, this.actor.uuid, this.now());
    if (!attempt) throw notFound("Source connection attempt");
    return serializeSourceConnectionAttempt(attempt);
  }

  private async assertIntentOwnership(intent: SourceConnectionIntent): Promise<void> {
    if (this.actor.kind !== "user" || intent.destination.kind !== "existing_vibe") return;
    const [owned] = await this.db
      .select({ uuid: vibes.uuid })
      .from(vibes)
      .where(
        and(eq(vibes.uuid, uriId(intent.destination.id)), eq(vibes.ownerUuid, this.actor.uuid)),
      )
      .limit(1);
    if (!owned) throw notFound("Vibe");
  }

  private fail(
    attemptUuid: string,
    errorCode: string,
    status: Extract<SourceConnectionAttemptStatus, "failed" | "rejected">,
  ): Promise<void> {
    return this.store.fail({ attemptUuid, errorCode, status, now: this.now() });
  }
}

export class DatabaseSourceConnectionAttemptStore implements SourceConnectionAttemptStore {
  constructor(private readonly db: Database) {}

  async assertCanCreate(input: {
    attemptLimit: number;
    ownerUuid: string;
    windowStart: Date;
  }): Promise<void> {
    const [owner] = await this.db
      .select({ uuid: users.uuid })
      .from(users)
      .where(eq(users.uuid, input.ownerUuid))
      .limit(1);
    if (!owner) throw notFound("User");
    const [recent] = await this.db
      .select({ value: count() })
      .from(sourceConnectionAttempts)
      .where(
        and(
          eq(sourceConnectionAttempts.userUuid, input.ownerUuid),
          gte(sourceConnectionAttempts.createdAt, input.windowStart),
        ),
      );
    assertAttemptAllowance(recent?.value ?? 0, input.attemptLimit);
  }

  create(
    input: NewDbSourceConnectionAttempt & { attemptLimit: number; windowStart: Date },
  ): Promise<DbSourceConnectionAttempt> {
    return this.db.transaction(async (transaction) => {
      const [owner] = await transaction
        .select({ uuid: users.uuid })
        .from(users)
        .where(eq(users.uuid, input.userUuid))
        .for("update");
      if (!owner) throw notFound("User");
      const [recent] = await transaction
        .select({ value: count() })
        .from(sourceConnectionAttempts)
        .where(
          and(
            eq(sourceConnectionAttempts.userUuid, input.userUuid),
            gte(sourceConnectionAttempts.createdAt, input.windowStart),
          ),
        );
      assertAttemptAllowance(recent?.value ?? 0, input.attemptLimit);
      const { attemptLimit: _attemptLimit, windowStart: _windowStart, ...attemptInput } = input;
      const [attempt] = await transaction
        .insert(sourceConnectionAttempts)
        .values(attemptInput)
        .returning();
      if (!attempt) throw new Error("Source connection attempt insert did not return a row");
      return attempt;
    });
  }

  claim(input: {
    actorUuid?: string;
    browserBindings: ReadonlyMap<string, string>;
    now: Date;
    stateHash: string;
  }): Promise<ClaimedAttempt> {
    return this.db.transaction(async (transaction) => {
      const [attempt] = await transaction
        .select()
        .from(sourceConnectionAttempts)
        .where(eq(sourceConnectionAttempts.stateHash, input.stateHash))
        .for("update");
      if (!attempt) return { kind: "missing" };
      if (
        input.browserBindings.get(attempt.uuid) !== attempt.browserBindingHash ||
        (input.actorUuid !== undefined && input.actorUuid !== attempt.userUuid)
      ) {
        return { kind: "missing" };
      }
      if (
        (attempt.status === "pending" || attempt.status === "exchanging") &&
        attempt.expiresAt.getTime() <= input.now.getTime()
      ) {
        await transaction
          .update(sourceConnectionAttempts)
          .set({
            status: "expired",
            errorCode: "oauth_attempt_expired",
            completedAt: input.now,
            updatedAt: input.now,
          })
          .where(eq(sourceConnectionAttempts.uuid, attempt.uuid));
        return { kind: "consumed" };
      }
      if (attempt.status !== "pending") return { kind: "consumed" };
      const [claimed] = await transaction
        .update(sourceConnectionAttempts)
        .set({ status: "exchanging", updatedAt: input.now })
        .where(
          and(
            eq(sourceConnectionAttempts.uuid, attempt.uuid),
            eq(sourceConnectionAttempts.status, "pending"),
          ),
        )
        .returning();
      return claimed ? { kind: "claimed", attempt: claimed } : { kind: "consumed" };
    });
  }

  async fail(input: {
    attemptUuid: string;
    errorCode: string;
    status: Extract<SourceConnectionAttemptStatus, "failed" | "rejected">;
    now: Date;
  }): Promise<void> {
    await this.db
      .update(sourceConnectionAttempts)
      .set({
        status: input.status,
        errorCode: input.errorCode,
        completedAt: input.now,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(sourceConnectionAttempts.uuid, input.attemptUuid),
          eq(sourceConnectionAttempts.status, "exchanging"),
        ),
      );
  }

  getOwned(
    attemptUuid: string,
    ownerUuid: string,
    now: Date,
  ): Promise<DbSourceConnectionAttempt | undefined> {
    return this.db.transaction(async (transaction) => {
      const [attempt] = await transaction
        .select()
        .from(sourceConnectionAttempts)
        .where(
          and(
            eq(sourceConnectionAttempts.uuid, attemptUuid),
            eq(sourceConnectionAttempts.userUuid, ownerUuid),
          ),
        )
        .for("update");
      if (!attempt) return undefined;
      if (
        (attempt.status === "pending" || attempt.status === "exchanging") &&
        attempt.expiresAt.getTime() <= now.getTime()
      ) {
        const [expired] = await transaction
          .update(sourceConnectionAttempts)
          .set({
            status: "expired",
            errorCode: "oauth_attempt_expired",
            completedAt: now,
            updatedAt: now,
          })
          .where(eq(sourceConnectionAttempts.uuid, attempt.uuid))
          .returning();
        return expired;
      }
      return attempt;
    });
  }

  async succeed(input: {
    attemptUuid: string;
    credential: NewDbSourceCredential;
    now: Date;
  }): Promise<DbSourceConnectionAttempt> {
    try {
      const completed = await this.db.transaction(async (transaction) => {
        const [attempt] = await transaction
          .select()
          .from(sourceConnectionAttempts)
          .where(
            and(
              eq(sourceConnectionAttempts.uuid, input.attemptUuid),
              eq(sourceConnectionAttempts.status, "exchanging"),
            ),
          )
          .for("update");
        if (!attempt) throw consumedOAuthCallback();
        if (attempt.expiresAt.getTime() <= input.now.getTime()) {
          await transaction
            .update(sourceConnectionAttempts)
            .set({
              status: "expired",
              errorCode: "oauth_attempt_expired",
              completedAt: input.now,
              updatedAt: input.now,
            })
            .where(eq(sourceConnectionAttempts.uuid, input.attemptUuid));
          return undefined;
        }
        const [credential] = await transaction
          .insert(sourceCredentials)
          .values(input.credential)
          .returning({ uuid: sourceCredentials.uuid });
        if (!credential) throw new Error("OAuth credential insert did not return a row");
        const [completedAttempt] = await transaction
          .update(sourceConnectionAttempts)
          .set({
            status: "succeeded",
            credentialUuid: credential.uuid,
            errorCode: null,
            completedAt: input.now,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(sourceConnectionAttempts.uuid, input.attemptUuid),
              eq(sourceConnectionAttempts.status, "exchanging"),
            ),
          )
          .returning();
        if (!completedAttempt) throw consumedOAuthCallback();
        return completedAttempt;
      });
      if (!completed) throw consumedOAuthCallback();
      return completed;
    } catch (error) {
      // A dropped commit acknowledgement is indistinguishable from a rolled-back commit at the
      // transport boundary. Reconcile by the deterministic attempt/credential ids before the
      // caller considers provider cleanup; revoking a token that did commit would invalidate a
      // durable active credential.
      let committed: DbSourceConnectionAttempt | undefined;
      try {
        [committed] = await this.db
          .select()
          .from(sourceConnectionAttempts)
          .where(
            and(
              eq(sourceConnectionAttempts.uuid, input.attemptUuid),
              eq(sourceConnectionAttempts.status, "succeeded"),
              eq(sourceConnectionAttempts.credentialUuid, input.credential.uuid),
            ),
          )
          .limit(1);
      } catch {
        throw new AmbiguousCredentialCommitError();
      }
      if (committed) return committed;
      throw error;
    }
  }
}

class AmbiguousCredentialCommitError extends Error {
  constructor() {
    super("OAuth credential commit outcome is ambiguous");
    this.name = "AmbiguousCredentialCommitError";
  }
}

export function oauthVerifierAssociatedData(
  attemptUuid: string,
  ownerUuid: string,
  skillId: string,
): string {
  return `rhizome:source-oauth-verifier:v1:${attemptUuid}:${ownerUuid}:${skillId}`;
}

export function serializeSourceConnectionAttempt(
  attempt: DbSourceConnectionAttempt,
): SourceConnectionAttemptDocument {
  const common = {
    attempt_id: attempt.uuid,
    skill_id: attempt.skillId,
    intent: attempt.intent as SourceConnectionIntent,
    expires_at: attempt.expiresAt.toISOString(),
    created_at: attempt.createdAt.toISOString(),
  };
  if (attempt.status === "pending" || attempt.status === "exchanging") {
    return { ...common, status: attempt.status };
  }
  if (attempt.status === "succeeded") {
    if (!attempt.credentialUuid || !attempt.completedAt || attempt.errorCode) {
      throw new Error("Succeeded source connection attempt has an invalid result");
    }
    return {
      ...common,
      status: "succeeded",
      credential: `credential:${attempt.credentialUuid}`,
      completed_at: attempt.completedAt.toISOString(),
    };
  }
  if (!attempt.errorCode || !attempt.completedAt || attempt.credentialUuid) {
    throw new Error("Terminal source connection attempt has an invalid result");
  }
  return {
    ...common,
    status: attempt.status,
    error_code: attempt.errorCode,
    completed_at: attempt.completedAt.toISOString(),
  };
}

function approvedReturnUrl(
  value: string,
  allowedOrigins: ReadonlySet<string>,
  intent: SourceConnectionIntent,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidReturnTarget();
  }
  if (
    !allowedOrigins.has(url.origin) ||
    Boolean(url.username || url.password || url.hash || url.search) ||
    !(/^\/imports\/?$/u.test(url.pathname) || /^\/vibes\/[0-9a-f-]{36}\/?$/iu.test(url.pathname))
  ) {
    throw invalidReturnTarget();
  }
  const vibePath = url.pathname.match(/^\/vibes\/([0-9a-f-]{36})\/?$/iu);
  const correctIntentPath =
    intent.destination.kind === "new_vibe"
      ? /^\/imports\/?$/u.test(url.pathname)
      : Boolean(vibePath) &&
        uriId(intent.destination.id).toLocaleLowerCase() === vibePath?.[1]?.toLocaleLowerCase();
  if (!correctIntentPath) {
    throw invalidReturnTarget();
  }
  return url.href;
}

function validatedAuthorizationUrl(
  connection: OAuth2PkceConnectionDefinition,
  input: { callbackUrl: string; codeChallenge: string; state: string },
  verifier: string,
): string {
  const value = connection.authorizationUrl(input);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("OAuth source produced an invalid authorization URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    new TextEncoder().encode(url.href).byteLength > MAX_AUTHORIZATION_URL_BYTES ||
    url.href.includes(verifier) ||
    !exactSearchParameter(url, "state", input.state) ||
    !exactSearchParameter(url, "code_challenge", input.codeChallenge) ||
    !exactSearchParameter(url, "code_challenge_method", "S256") ||
    !exactSearchParameter(url, "redirect_uri", input.callbackUrl) ||
    !exactSearchParameter(url, "response_type", "code") ||
    [...url.searchParams.keys()].some(isSensitiveAuthorizationParameter)
  ) {
    throw new Error("OAuth source produced an unsafe authorization URL");
  }
  return url.href;
}

function isSensitiveAuthorizationParameter(name: string): boolean {
  const normalized = name.toLocaleLowerCase().replace(/[^a-z0-9]/gu, "");
  return (
    normalized === "code" ||
    normalized === "authorizationcode" ||
    normalized.includes("verifier") ||
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("token")
  );
}

function exactSearchParameter(url: URL, name: string, expected: string): boolean {
  const values = url.searchParams.getAll(name);
  return values.length === 1 && values[0] === expected;
}

function completionUrl(returnUrl: string, attemptUuid: string): string {
  const url = new URL(returnUrl);
  url.searchParams.set("source_connection", attemptUuid);
  return url.href;
}

function randomBase64Url(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Buffer.from(bytes).toString("base64url");
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(digest).toString("base64url");
}

async function oauthStateHash(state: string): Promise<string> {
  if (state.length < 32 || state.length > 512 || /\s/u.test(state)) throw invalidOAuthCallback();
  return sha256Fingerprint(state);
}

async function sha256Fingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${Buffer.from(digest).toString("hex")}`;
}

function sourceConnectionBindingCookie(
  attemptUuid: string,
  binding: string,
  callbackUrl: string,
): string {
  const secure = new URL(callbackUrl).protocol === "https:" ? "; Secure" : "";
  return `${bindingCookieName(attemptUuid)}=${binding}; Path=${CALLBACK_PATH}; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ATTEMPT_TTL_MILLISECONDS / 1_000)}${secure}`;
}

export function clearSourceConnectionBindingCookie(
  attemptUuid: string,
  callbackUrl: string,
): string {
  const secure = new URL(callbackUrl).protocol === "https:" ? "; Secure" : "";
  return `${bindingCookieName(attemptUuid)}=; Path=${CALLBACK_PATH}; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

async function sourceConnectionBindingHashes(
  cookieHeader: string | undefined,
): Promise<ReadonlyMap<string, string>> {
  const bindings = new Map<string, string>();
  for (const part of (cookieHeader ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const match = name.match(/^rhizome_oauth_([0-9a-f-]{36})$/iu);
    const value = part.slice(separator + 1).trim();
    if (!match?.[1] || !/^[A-Za-z0-9_-]{43}$/u.test(value)) continue;
    bindings.set(match[1], await sha256Fingerprint(value));
  }
  return bindings;
}

function bindingCookieName(attemptUuid: string): string {
  return `rhizome_oauth_${attemptUuid}`;
}

function unsupportedSkill(skillId: string): Problem {
  return new Problem(
    422,
    "parser_unsupported",
    "Source skill unsupported",
    `Source skill ${skillId} is not installed`,
  );
}

function assertAttemptAllowance(recentAttemptCount: number, attemptLimit: number): void {
  if (recentAttemptCount < attemptLimit) return;
  throw new Problem(
    429,
    "rate_limited",
    "Too many connection attempts",
    "Wait before starting another source connection",
  );
}

function connectionModeMismatch(): Problem {
  return new Problem(
    422,
    "schema_violation",
    "Connection mode mismatch",
    "This source does not advertise OAuth 2.0 PKCE",
  );
}

function invalidReturnTarget(): Problem {
  return new Problem(
    422,
    "schema_violation",
    "Invalid return target",
    "The source connection return target is not approved by this server",
  );
}

function invalidOAuthCallback(): Problem {
  return new Problem(
    422,
    "source_connection_failed",
    "Source connection failed",
    "The OAuth callback could not be matched to a pending connection",
  );
}

function consumedOAuthCallback(): Problem {
  return new Problem(
    422,
    "source_connection_failed",
    "Source connection failed",
    "This OAuth callback is expired or was already consumed",
  );
}
