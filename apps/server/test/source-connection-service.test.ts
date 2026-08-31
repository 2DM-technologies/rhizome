import { describe, expect, test } from "bun:test";
import type { SourceConnectionIntent } from "@rhizome/store-contract";

import {
  CredentialConnectionError,
  CredentialedSourceCatalog,
  type CredentialedSourceSkill,
} from "../../ingest/connected-sources/types.ts";
import {
  CANDIDATE_BUNDLE_CAPABILITY,
  candidateBundle,
} from "../../ingest/source-skills/candidate-bundle.ts";
import { createLocalSourceCredentialCrypto } from "../src/services/source-credential-crypto.ts";
import type { SourceCredentialCrypto } from "../src/services/source-credential-crypto.ts";
import {
  AmbiguousCredentialCommitError,
  SourceConnectionService,
  oauthVerifierAssociatedData,
  type SourceConnectionAttemptStore,
} from "../src/services/source-connection-service.ts";
import type {
  DbSourceConnectionAttempt,
  NewDbSourceConnectionAttempt,
} from "../src/db/models/source-connection-attempt.ts";
import type {
  DbSourceCredential,
  NewDbSourceCredential,
} from "../src/db/models/source-credential.ts";
import { credentialAssociatedData } from "../src/services/source-credential-crypto.ts";
import type { Actor } from "../src/auth.ts";
import type { Database } from "../src/db/index.ts";
import { Problem } from "../src/errors.ts";

const ownerUuid = "0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47";
const otherOwnerUuid = "0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b49";
const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const returnUrl = "https://host.example/imports";
const callbackUrl = "https://api.example/rnet/v0/source-connections/oauth/callback";
const intent = {
  kind: "review_import",
  destination: { kind: "new_vibe" },
} as const satisfies SourceConnectionIntent;

describe("generic OAuth 2.0 PKCE connections", () => {
  test("persists only hashed state and an encrypted verifier bound to the exact attempt", async () => {
    const store = new MemoryAttemptStore();
    const observed: Array<{ callbackUrl: string; codeChallenge: string; state: string }> = [];
    const service = serviceFor({
      store,
      skill: oauthSkill({
        authorization(input) {
          observed.push(input);
          return authorizationUrl(input);
        },
      }),
    });

    const result = await service.start("synthetic_oauth", {
      return_to: returnUrl,
      intent,
    });

    expect(result.attempt).toMatchObject({
      skill_id: "synthetic_oauth",
      status: "pending",
      intent,
    });
    const authorization = new URL(result.attempt.authorization_url!);
    expect(authorization.protocol).toBe("https:");
    expect(authorization.searchParams.get("redirect_uri")).toBe(callbackUrl);
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get("code_challenge")).toHaveLength(43);
    const state = authorization.searchParams.get("state")!;
    expect(state.length).toBeGreaterThanOrEqual(43);
    expect(observed).toHaveLength(1);

    const stored = store.attempts.get(result.attempt.attempt_id)!;
    expect(stored.stateHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(stored.stateHash).not.toContain(state);
    expect(new TextDecoder().decode(stored.verifier)).not.toContain(state);
    expect(stored.callbackUrl).toBe(callbackUrl);
    expect(stored.returnUrl).toBe(returnUrl);
    expect(stored.intent).toEqual(intent);
    const verifier = await createLocalSourceCredentialCrypto(key).open(
      stored.verifier,
      oauthVerifierAssociatedData(stored.uuid, ownerUuid, stored.skillId),
    );
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(result.attempt).not.toHaveProperty("state");
    expect(JSON.stringify(result.attempt)).not.toContain(verifier);
  });

  test("consumes state once, uses the exact callback binding, and atomically seals tokens", async () => {
    const store = new MemoryAttemptStore();
    const exchanges: Array<{ callbackUrl: string; code: string; codeVerifier: string }> = [];
    const service = serviceFor({
      store,
      skill: oauthSkill({
        async exchange(input) {
          exchanges.push(input);
          return {
            secret: JSON.stringify({
              access_token: "ACCESS-SENTINEL",
              refresh_token: "REFRESH-SENTINEL",
            }),
            publicMetadata: { account: "synthetic" },
          };
        },
      }),
    });
    const started = await service.start("synthetic_oauth", { return_to: returnUrl, intent });
    const state = new URL(started.attempt.authorization_url!).searchParams.get("state")!;

    const redirect = await service.complete(
      { state, code: "AUTHORIZATION-CODE-SENTINEL" },
      cookieHeader(started),
    );

    expect(redirect.returnUrl).toBe(`${returnUrl}?source_connection=${started.attempt.attempt_id}`);
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]).toMatchObject({ callbackUrl, code: "AUTHORIZATION-CODE-SENTINEL" });
    const status = await service.getOwned(started.attempt.attempt_id);
    expect(status).toMatchObject({ status: "succeeded", intent });
    expect(status.credential).toMatch(/^credential:/);
    expect(JSON.stringify(status)).not.toContain("AUTHORIZATION-CODE-SENTINEL");
    expect(JSON.stringify(status)).not.toContain("ACCESS-SENTINEL");
    const credential = [...store.credentials.values()][0]!;
    const secret = await createLocalSourceCredentialCrypto(key).open(
      credential.secret,
      credentialAssociatedData(credential.uuid, ownerUuid, credential.skillId),
    );
    expect(JSON.parse(secret)).toEqual({
      access_token: "ACCESS-SENTINEL",
      refresh_token: "REFRESH-SENTINEL",
    });

    await expect(
      service.complete({ state, code: "REPLAYED-CODE" }, cookieHeader(started)),
    ).rejects.toMatchObject({ code: "source_connection_failed" });
    expect(exchanges).toHaveLength(1);
  });

  test("rejects missing or incorrect browser bindings without consuming state", async () => {
    const store = new MemoryAttemptStore();
    let exchanges = 0;
    const service = serviceFor({
      store,
      skill: oauthSkill({
        async exchange() {
          exchanges += 1;
          return { secret: "must-not-be-used" };
        },
      }),
    });
    const started = await service.start("synthetic_oauth", { return_to: returnUrl, intent });
    const state = new URL(started.attempt.authorization_url!).searchParams.get("state")!;
    const cookieName = cookieHeader(started).split("=", 1)[0]!;

    for (const binding of [undefined, `${cookieName}=${"A".repeat(43)}`]) {
      await expect(
        service.complete({ state, code: "MUST-NOT-BE-EXCHANGED" }, binding),
      ).rejects.toMatchObject({ code: "source_connection_failed" });
    }

    expect(exchanges).toBe(0);
    expect(await service.getOwned(started.attempt.attempt_id)).toMatchObject({
      status: "pending",
    });

    await service.complete({ state, code: "valid-after-rejected-bindings" }, cookieHeader(started));
    expect(exchanges).toBe(1);
  });

  test("rejects a callback from the wrong authenticated actor without consuming state", async () => {
    const store = new MemoryAttemptStore();
    let exchanges = 0;
    const skill = oauthSkill({
      async exchange() {
        exchanges += 1;
        return { secret: "synthetic-token-set" };
      },
    });
    const owner = serviceFor({ store, skill });
    const started = await owner.start("synthetic_oauth", { return_to: returnUrl, intent });
    const state = new URL(started.attempt.authorization_url!).searchParams.get("state")!;
    const other = serviceFor({ store, skill, actor: ownerActor(otherOwnerUuid) });

    await expect(
      other.complete({ state, code: "MUST-NOT-BE-EXCHANGED" }, cookieHeader(started)),
    ).rejects.toMatchObject({ code: "source_connection_failed" });
    expect(exchanges).toBe(0);
    expect(await owner.getOwned(started.attempt.attempt_id)).toMatchObject({ status: "pending" });

    await owner.complete({ state, code: "owner-code" }, cookieHeader(started));
    expect(exchanges).toBe(1);
  });

  test("rejects duplicated, missing, or mutated authorization security parameters", async () => {
    const cases: Array<{
      label: string;
      mutate: (url: URL) => void;
    }> = [
      {
        label: "duplicate state",
        mutate: (url) => url.searchParams.append("state", url.searchParams.get("state")!),
      },
      {
        label: "missing PKCE method",
        mutate: (url) => url.searchParams.delete("code_challenge_method"),
      },
      {
        label: "mutated callback",
        mutate: (url) => url.searchParams.set("redirect_uri", "https://evil.example/callback"),
      },
      {
        label: "leaked verifier",
        mutate: (url) => url.searchParams.set("code_verifier", "provider-must-not-receive-this"),
      },
      {
        label: "uppercase client secret",
        mutate: (url) => url.searchParams.set("CLIENT_SECRET", "provider-secret"),
      },
      {
        label: "camel-case client secret",
        mutate: (url) => url.searchParams.set("clientSecret", "provider-secret"),
      },
      {
        label: "hyphenated access token",
        mutate: (url) => url.searchParams.set("access-token", "provider-token"),
      },
    ];

    for (const testCase of cases) {
      const store = new MemoryAttemptStore();
      const service = serviceFor({
        store,
        skill: oauthSkill({
          authorization(input) {
            const url = new URL(authorizationUrl(input));
            testCase.mutate(url);
            return url.href;
          },
        }),
      });

      await expect(
        service.start("synthetic_oauth", { return_to: returnUrl, intent }),
      ).rejects.toThrow("unsafe authorization URL");
      expect(store.attempts.size, testCase.label).toBe(0);
    }
  });

  test("rejects an exhausted start preflight before crypto or provider code runs", async () => {
    const store = new RateLimitedAttemptStore();
    const delegate = createLocalSourceCredentialCrypto(key);
    let prepareSealCalls = 0;
    let authorizationCalls = 0;
    const credentialCrypto: SourceCredentialCrypto = {
      ...delegate,
      async prepareSeal(associatedData) {
        prepareSealCalls += 1;
        return delegate.prepareSeal(associatedData);
      },
    };
    const service = serviceFor({
      store,
      credentialCrypto,
      skill: oauthSkill({
        authorization(input) {
          authorizationCalls += 1;
          return authorizationUrl(input);
        },
      }),
    });

    await expect(
      service.start("synthetic_oauth", { return_to: returnUrl, intent }),
    ).rejects.toMatchObject({ status: 429, code: "rate_limited" });
    expect(prepareSealCalls).toBe(0);
    expect(authorizationCalls).toBe(0);
    expect(store.attempts.size).toBe(0);
  });

  test("expires pending attempts and rejects callbacks without contacting the provider", async () => {
    const store = new MemoryAttemptStore();
    let now = new Date("2026-08-31T12:00:00.000Z");
    let exchanges = 0;
    const service = serviceFor({
      store,
      now: () => now,
      skill: oauthSkill({
        async exchange() {
          exchanges += 1;
          return { secret: "must-not-be-used" };
        },
      }),
    });
    const started = await service.start("synthetic_oauth", { return_to: returnUrl, intent });
    const state = new URL(started.attempt.authorization_url!).searchParams.get("state")!;
    now = new Date("2026-08-31T12:11:00.000Z");

    await expect(
      service.complete({ state, code: "late" }, cookieHeader(started)),
    ).rejects.toMatchObject({
      code: "source_connection_failed",
    });
    expect(exchanges).toBe(0);
    expect(await service.getOwned(started.attempt.attempt_id)).toMatchObject({
      status: "expired",
      error_code: "oauth_attempt_expired",
    });
  });

  test("binds status to the owner and rejects unapproved or credentialed return targets", async () => {
    const store = new MemoryAttemptStore();
    const skill = oauthSkill();
    const owner = serviceFor({ store, skill });
    const started = await owner.start("synthetic_oauth", { return_to: returnUrl, intent });
    const other = serviceFor({ store, skill, actor: ownerActor(otherOwnerUuid) });
    await expect(other.getOwned(started.attempt.attempt_id)).rejects.toMatchObject({ status: 404 });

    for (const unsafe of [
      "https://evil.example/imports",
      "https://user:pass@host.example/imports",
      "https://host.example/imports?next=https://evil.example",
      "https://host.example//evil.example",
    ]) {
      await expect(
        owner.start("synthetic_oauth", { return_to: unsafe, intent }),
      ).rejects.toMatchObject({ code: "schema_violation" });
    }
  });

  test("maps provider denial to a safe terminal result without exposing provider text", async () => {
    const store = new MemoryAttemptStore();
    let exchanges = 0;
    const service = serviceFor({
      store,
      skill: oauthSkill({
        callbackError() {
          return new CredentialConnectionError("provider_access_denied", "rejected", "Safe denial");
        },
        async exchange() {
          exchanges += 1;
          return { secret: "unused" };
        },
      }),
    });
    const started = await service.start("synthetic_oauth", { return_to: returnUrl, intent });
    const state = new URL(started.attempt.authorization_url!).searchParams.get("state")!;
    const sensitiveDescription = "provider trace and account details";

    await service.complete(
      { state, error: "access_denied", errorDescription: sensitiveDescription },
      cookieHeader(started),
    );

    expect(exchanges).toBe(0);
    const status = await service.getOwned(started.attempt.attempt_id);
    expect(status).toMatchObject({ status: "rejected", error_code: "provider_access_denied" });
    expect(JSON.stringify(status)).not.toContain(sensitiveDescription);
  });

  test("contains a throwing provider callback mapper as a safe terminal failure", async () => {
    const store = new MemoryAttemptStore();
    const callbackSentinel = "CALLBACK-MAPPER-INTERNAL-SENTINEL";
    const providerSentinel = "PROVIDER-DESCRIPTION-SENTINEL";
    const service = serviceFor({
      store,
      skill: oauthSkill({
        callbackError() {
          throw new Error(callbackSentinel);
        },
      }),
    });
    const started = await service.start("synthetic_oauth", { return_to: returnUrl, intent });
    const state = new URL(started.attempt.authorization_url!).searchParams.get("state")!;

    const redirect = await service.complete(
      { state, error: "provider_error", errorDescription: providerSentinel },
      cookieHeader(started),
    );

    expect(redirect.returnUrl).toBe(`${returnUrl}?source_connection=${started.attempt.attempt_id}`);
    const status = await service.getOwned(started.attempt.attempt_id);
    expect(status).toMatchObject({
      status: "failed",
      error_code: "oauth_provider_rejected",
    });
    const publicResult = JSON.stringify({ redirect, status });
    expect(publicResult).not.toContain(callbackSentinel);
    expect(publicResult).not.toContain(providerSentinel);
    expect(status).not.toHaveProperty("authorization_url");
    expect(status).not.toHaveProperty("credential");
  });

  test("best-effort revokes an exchanged token when credential commit fails", async () => {
    const store = new FailingSucceedAttemptStore();
    const acquiredSecret = "POST-EXCHANGE-SECRET-SENTINEL";
    const revoked: string[] = [];
    const service = serviceFor({
      store,
      skill: oauthSkill({
        async exchange() {
          return { secret: acquiredSecret };
        },
        async revoke(secret) {
          revoked.push(secret);
          throw new Error("provider cleanup is deliberately best-effort");
        },
      }),
    });
    const started = await service.start("synthetic_oauth", { return_to: returnUrl, intent });
    const state = new URL(started.attempt.authorization_url).searchParams.get("state")!;

    await service.complete({ state, code: "authorization-code" }, cookieHeader(started));

    expect(revoked).toEqual([acquiredSecret]);
    expect(store.credentials.size).toBe(0);
    const status = await service.getOwned(started.attempt.attempt_id);
    expect(status).toMatchObject({ status: "failed", error_code: "oauth_exchange_failed" });
    expect(JSON.stringify(status)).not.toContain(acquiredSecret);
  });

  test("revokes an ambiguously committed token only when failure transition proves rollback", async () => {
    const rolledBackSecret = "AMBIGUOUS-ROLLBACK-SECRET";
    const committedSecret = "AMBIGUOUS-COMMIT-SECRET";
    const revoked: string[] = [];
    const skill = oauthSkill({
      async exchange(input) {
        return {
          secret: input.code === "rolled-back" ? rolledBackSecret : committedSecret,
        };
      },
      async revoke(secret) {
        revoked.push(secret);
      },
    });

    const rolledBackStore = new AmbiguousSucceedAttemptStore(false);
    const rolledBackService = serviceFor({ store: rolledBackStore, skill });
    const rolledBack = await rolledBackService.start("synthetic_oauth", {
      return_to: returnUrl,
      intent,
    });
    const rolledBackState = new URL(rolledBack.attempt.authorization_url).searchParams.get(
      "state",
    )!;
    await rolledBackService.complete(
      { state: rolledBackState, code: "rolled-back" },
      cookieHeader(rolledBack),
    );

    const committedStore = new AmbiguousSucceedAttemptStore(true);
    const committedService = serviceFor({ store: committedStore, skill });
    const committed = await committedService.start("synthetic_oauth", {
      return_to: returnUrl,
      intent,
    });
    const committedState = new URL(committed.attempt.authorization_url).searchParams.get("state")!;
    await committedService.complete(
      { state: committedState, code: "committed" },
      cookieHeader(committed),
    );

    expect(revoked).toEqual([rolledBackSecret]);
    expect(await rolledBackService.getOwned(rolledBack.attempt.attempt_id)).toMatchObject({
      status: "failed",
    });
    expect(await committedService.getOwned(committed.attempt.attempt_id)).toMatchObject({
      status: "succeeded",
    });
  });
});

function serviceFor(options: {
  store: SourceConnectionAttemptStore;
  skill: CredentialedSourceSkill;
  actor?: Actor;
  credentialCrypto?: SourceCredentialCrypto;
  now?: () => Date;
}): SourceConnectionService {
  return new SourceConnectionService({
    db: {} as Database,
    actor: options.actor ?? ownerActor(ownerUuid),
    baseUrl: "https://api.example",
    allowedReturnOrigins: ["https://host.example"],
    catalog: new CredentialedSourceCatalog([options.skill]),
    credentialCrypto: options.credentialCrypto ?? createLocalSourceCredentialCrypto(key),
    store: options.store,
    ...(options.now ? { now: options.now } : {}),
  });
}

function oauthSkill(
  options: {
    authorization?: (input: {
      callbackUrl: string;
      codeChallenge: string;
      state: string;
    }) => string;
    callbackError?: (input: {
      error: string;
      errorDescription?: string;
    }) => CredentialConnectionError;
    exchange?: (input: {
      callbackUrl: string;
      code: string;
      codeVerifier: string;
    }) => Promise<{ secret: string; publicMetadata?: Record<string, string> }>;
    revoke?: (secret: string, input: { signal: AbortSignal }) => Promise<void>;
  } = {},
): CredentialedSourceSkill {
  return {
    skillId: "synthetic_oauth",
    displayName: "Synthetic OAuth",
    manifest: {
      skill_id: "synthetic_oauth",
      label: "Synthetic OAuth",
      description: "Synthetic OAuth source for generic platform conformance.",
      source_kind: "credentialed_remote",
      connector_version: "synthetic-oauth@1",
      parser: { name: "synthetic-oauth", version: "synthetic-oauth@1" },
      limits: {
        maxCandidates: 10,
        maxCaptureBytes: 1_024,
        maxElementBytes: 512,
        maxTotalElementBytes: 1_024,
      },
      connection: { mode: "oauth2_pkce", button_label: "Connect synthetic source" },
      input_fields: [],
      review_actions: ["review_import", "refresh_source"],
    },
    connection: {
      mode: "oauth2_pkce",
      authorizationUrl(input) {
        return options.authorization?.(input) ?? authorizationUrl(input);
      },
      callbackError: options.callbackError,
      async exchange(input) {
        return options.exchange?.(input) ?? { secret: "synthetic-token-set" };
      },
      revoke: options.revoke,
    },
    parser: {
      name: "synthetic-oauth",
      version: "synthetic-oauth@1",
      async parse() {
        return {};
      },
    },
    sourceRequestSchema: { type: "object", properties: {}, additionalProperties: false },
    fetchPolicy: { attempts: 10, windowHours: 1 },
    capture: { mime: "application/json", label: (id) => `${id}.json` },
    parseConfig: (value) => value,
    prepareFetch() {
      return {
        async retrieve() {
          return new Uint8Array();
        },
        compiledSource: {
          kind: CANDIDATE_BUNDLE_CAPABILITY,
          async compile() {
            return candidateBundle([], { ok: true, checks: [] });
          },
        },
      };
    },
  };
}

function authorizationUrl(input: {
  callbackUrl: string;
  codeChallenge: string;
  state: string;
}): string {
  const url = new URL("https://provider.example/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", input.callbackUrl);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.href;
}

function ownerActor(uuid: string): Actor {
  return { kind: "user", uuid, subject: `id:rnet://id/${uuid}` };
}

class MemoryAttemptStore implements SourceConnectionAttemptStore {
  readonly attempts = new Map<string, DbSourceConnectionAttempt>();
  readonly credentials = new Map<string, DbSourceCredential>();

  async assertCanCreate(input: {
    attemptLimit: number;
    ownerUuid: string;
    windowStart: Date;
  }): Promise<void> {
    const recent = [...this.attempts.values()].filter(
      (attempt) =>
        attempt.userUuid === input.ownerUuid &&
        attempt.createdAt.getTime() >= input.windowStart.getTime(),
    ).length;
    if (recent >= input.attemptLimit) {
      throw new Problem(
        429,
        "rate_limited",
        "Too many connection attempts",
        "Wait before starting another source connection",
      );
    }
  }

  async create(
    input: NewDbSourceConnectionAttempt & { attemptLimit: number; windowStart: Date },
  ): Promise<DbSourceConnectionAttempt> {
    const { attemptLimit: _attemptLimit, windowStart: _windowStart, ...value } = input;
    const attempt = storedAttempt(value);
    this.attempts.set(attempt.uuid, attempt);
    return attempt;
  }

  async claim(input: {
    actorUuid?: string;
    browserBindings: ReadonlyMap<string, string>;
    now: Date;
    stateHash: string;
  }) {
    const attempt = [...this.attempts.values()].find(
      (value) => value.stateHash === input.stateHash,
    );
    if (!attempt) return { kind: "missing" as const };
    if (
      input.browserBindings.get(attempt.uuid) !== attempt.browserBindingHash ||
      (input.actorUuid !== undefined && input.actorUuid !== attempt.userUuid)
    ) {
      return { kind: "missing" as const };
    }
    if (attempt.status !== "pending") return { kind: "consumed" as const };
    if (attempt.expiresAt.getTime() <= input.now.getTime()) {
      Object.assign(attempt, {
        status: "expired",
        errorCode: "oauth_attempt_expired",
        completedAt: input.now,
        updatedAt: input.now,
      });
      return { kind: "consumed" as const };
    }
    attempt.status = "exchanging";
    attempt.updatedAt = input.now;
    return { kind: "claimed" as const, attempt };
  }

  async fail(input: {
    attemptUuid: string;
    errorCode: string;
    status: "failed" | "rejected";
    now: Date;
  }) {
    const attempt = this.attempts.get(input.attemptUuid)!;
    if (attempt.status !== "exchanging") return false;
    Object.assign(attempt, {
      status: input.status,
      errorCode: input.errorCode,
      completedAt: input.now,
      updatedAt: input.now,
    });
    return true;
  }

  async getOwned(attemptUuid: string, ownerUuid: string, now: Date) {
    const attempt = this.attempts.get(attemptUuid);
    if (!attempt || attempt.userUuid !== ownerUuid) return undefined;
    if (
      (attempt.status === "pending" || attempt.status === "exchanging") &&
      attempt.expiresAt.getTime() <= now.getTime()
    ) {
      Object.assign(attempt, {
        status: "expired",
        errorCode: "oauth_attempt_expired",
        completedAt: now,
        updatedAt: now,
      });
    }
    return attempt;
  }

  async succeed(input: { attemptUuid: string; credential: NewDbSourceCredential; now: Date }) {
    const credential = storedCredential(input.credential);
    this.credentials.set(credential.uuid, credential);
    const attempt = this.attempts.get(input.attemptUuid)!;
    Object.assign(attempt, {
      status: "succeeded",
      credentialUuid: credential.uuid,
      errorCode: null,
      completedAt: input.now,
      updatedAt: input.now,
    });
    return attempt;
  }
}

class RateLimitedAttemptStore extends MemoryAttemptStore {
  override async assertCanCreate(): Promise<void> {
    throw new Problem(
      429,
      "rate_limited",
      "Too many connection attempts",
      "Wait before starting another source connection",
    );
  }
}

class FailingSucceedAttemptStore extends MemoryAttemptStore {
  override async succeed(): Promise<DbSourceConnectionAttempt> {
    throw new Error("synthetic credential commit failure");
  }
}

class AmbiguousSucceedAttemptStore extends MemoryAttemptStore {
  constructor(private readonly commitBeforeFailure: boolean) {
    super();
  }

  override async succeed(input: {
    attemptUuid: string;
    credential: NewDbSourceCredential;
    now: Date;
  }): Promise<DbSourceConnectionAttempt> {
    if (this.commitBeforeFailure) await super.succeed(input);
    throw new AmbiguousCredentialCommitError();
  }
}

function storedAttempt(value: NewDbSourceConnectionAttempt): DbSourceConnectionAttempt {
  return {
    ...value,
    status: value.status ?? "pending",
    credentialUuid: value.credentialUuid ?? null,
    errorCode: value.errorCode ?? null,
    createdAt: value.createdAt ?? new Date(),
    updatedAt: value.updatedAt ?? new Date(),
    completedAt: value.completedAt ?? null,
  } as DbSourceConnectionAttempt;
}

function storedCredential(value: NewDbSourceCredential): DbSourceCredential {
  return {
    ...value,
    metadata: value.metadata ?? null,
    connectedAt: value.connectedAt ?? new Date(),
    revokedAt: value.revokedAt ?? null,
  } as DbSourceCredential;
}

function cookieHeader(started: { browserBindingCookie: string }): string {
  return started.browserBindingCookie.split(";", 1)[0]!;
}
