import { describe, expect, test } from "bun:test";

import {
  CredentialConnectionError,
  type CredentialClaimFingerprintCompatibility,
  type CredentialClaimPolicy,
  type CredentialSourceConnector,
  type SourceJsonObject,
} from "../../ingest/connected-sources/types.ts";
import type { Database } from "../src/db/index.ts";
import type {
  DbSourceCredential,
  NewDbSourceCredential,
} from "../src/db/models/source-credential.ts";
import { Problem } from "../src/errors.ts";
import {
  createCredentialKeyring,
  createLocalSourceCredentialCrypto,
  credentialAssociatedData,
  openCredentialSecret,
  type SourceCredentialCrypto,
} from "../src/services/source-credential-crypto.ts";
import {
  SourceCredentialsService,
  serializeSourceCredential,
  type SourceCredentialClaimStore,
} from "../src/services/source-credential-service.ts";

const ownerUuid = "0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47";
const skillId = "test-provider";
const connectorVersion = "test-provider-connector@1.0.0";
const replayKey = "opaque-one-time-claim";
const providerSecret = "opaque-provider-secret";
const key = Uint8Array.from({ length: 32 }, (_, index) => index);

describe("source credential service", () => {
  test("persists only owner-bound ciphertext and deduplicates a skill's canonical replay key", async () => {
    const inserted: NewDbSourceCredential[] = [];
    let acquisitions = 0;
    const skill = fakeCredentialedSkill({
      async acquire() {
        acquisitions += 1;
        return { secret: providerSecret, publicMetadata: { account_count: 2 } };
      },
    });
    const service = new SourceCredentialsService({
      db: emptyDatabase(),
      actor: ownerActor(),
      claimStore: memoryClaimStore(inserted),
      credentialEncryptionKey: key,
    });

    const credential = await service.connect(skill, { claim: ` ${replayKey} ` });
    expect(await service.connect(skill, { claim: replayKey })).toEqual(credential);
    expect(acquisitions).toBe(1);
    expect(inserted).toHaveLength(1);
    const stored = inserted[0]!;
    expect(stored).toMatchObject({
      userUuid: ownerUuid,
      skillId,
      connectorVersion,
      metadata: { account_count: 2 },
    });
    expect(new TextDecoder().decode(stored.secret)).not.toContain(providerSecret);
    expect(JSON.stringify(stored)).not.toContain(replayKey);
    expect(
      await openCredentialSecret(
        stored.secret,
        key,
        credentialAssociatedData(credential.uuid, ownerUuid, skillId),
      ),
    ).toBe(providerSecret);

    const document = serializeSourceCredential(credential);
    expect(document).toMatchObject({
      skill_id: skillId,
      connector_version: connectorVersion,
      status: "active",
    });
    expect(JSON.stringify(document)).not.toContain(providerSecret);
  });

  test("passes skill-owned fingerprint compatibility profiles to generic credential crypto", async () => {
    const compatibility: CredentialClaimFingerprintCompatibility[] = [
      {
        claim: "legacy-canonical-claim",
        localHkdfInfo: "rhizome:test-provider-claim-fingerprint:v0",
        kmsDigestDomain: "rhizome:test-provider-claim-fingerprint:kms-v0",
      },
    ];
    const localCrypto = createLocalSourceCredentialCrypto(key);
    let observed: readonly CredentialClaimFingerprintCompatibility[] | undefined;
    const credentialCrypto: SourceCredentialCrypto = {
      async fingerprintConnectionClaim(claimSkillId, claim, profiles) {
        observed = profiles;
        return localCrypto.fingerprintConnectionClaim(claimSkillId, claim, profiles);
      },
      open: (sealed, associatedData) => localCrypto.open(sealed, associatedData),
      prepareSeal: (associatedData) => localCrypto.prepareSeal(associatedData),
    };
    const service = new SourceCredentialsService({
      db: emptyDatabase(),
      actor: ownerActor(),
      claimStore: memoryClaimStore([]),
      credentialCrypto,
    });

    await service.connect(fakeCredentialedSkill({ fingerprintCompatibility: compatibility }), {
      claim: replayKey,
    });

    expect(observed).toEqual(compatibility);
  });

  test("rejects clients before skill preparation and preserves only provider-safe failures", async () => {
    let preparations = 0;
    let acquisitions = 0;
    const safeDetail =
      "The provider rejected these one-time connection details; disable them before trying again";
    const skill = fakeCredentialedSkill({
      onPrepare() {
        preparations += 1;
      },
      async acquire() {
        acquisitions += 1;
        throw new CredentialConnectionError("claim_rejected", "rejected", safeDetail);
      },
    });
    const inserted: NewDbSourceCredential[] = [];
    const failures: RecordedClaimFailure[] = [];
    const claimStore = memoryClaimStore(inserted, failures);
    const clientService = new SourceCredentialsService({
      db: emptyDatabase(),
      actor: {
        kind: "client",
        uuid: "0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b48",
        name: "rbudget",
        subject: "client:rbudget",
      },
      claimStore,
      credentialEncryptionKey: key,
    });
    await expect(clientService.connect(skill, { claim: replayKey })).rejects.toMatchObject({
      status: 403,
      code: "grant_missing",
    });
    expect(preparations).toBe(0);
    expect(acquisitions).toBe(0);

    const ownerService = new SourceCredentialsService({
      db: emptyDatabase(),
      actor: ownerActor(),
      claimStore,
      credentialEncryptionKey: key,
    });
    let failure: unknown;
    try {
      await ownerService.connect(skill, { claim: replayKey });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Problem);
    expect(failure).toMatchObject({
      status: 422,
      code: "source_connection_failed",
      detail: safeDetail,
    });
    expect((failure as Error).message).not.toContain(replayKey);
    expect(failures).toContainEqual(
      expect.objectContaining({ errorCode: "claim_rejected", status: "rejected" }),
    );
    expect(inserted).toHaveLength(0);
  });

  test("records unknown acquisition failures as ambiguous without exposing their details", async () => {
    const privateFailure = "upstream response carried private account details";
    const failures: RecordedClaimFailure[] = [];
    const service = new SourceCredentialsService({
      db: emptyDatabase(),
      actor: ownerActor(),
      claimStore: memoryClaimStore([], failures),
      credentialEncryptionKey: key,
    });
    const skill = fakeCredentialedSkill({
      async acquire() {
        throw new Error(privateFailure);
      },
    });

    let failure: unknown;
    try {
      await service.connect(skill, { claim: replayKey });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      status: 422,
      code: "source_connection_failed",
      detail:
        "The source could not complete the connection request; verify the connection and try again",
    });
    expect((failure as Error).message).not.toContain(privateFailure);
    expect(failures).toContainEqual(
      expect.objectContaining({
        errorCode: "connection_acquire_failed",
        status: "ambiguous",
      }),
    );
  });

  test("prepares credential protection before acquiring a one-time provider secret", async () => {
    const inserted: NewDbSourceCredential[] = [];
    const claimStore = memoryClaimStore(inserted);
    const localCrypto = createLocalSourceCredentialCrypto(key);
    let keyPreparations = 0;
    let acquisitions = 0;
    const credentialCrypto: SourceCredentialCrypto = {
      fingerprintConnectionClaim: (claimProvider, claim) =>
        localCrypto.fingerprintConnectionClaim(claimProvider, claim),
      open: (sealed, associatedData) => localCrypto.open(sealed, associatedData),
      async prepareSeal(associatedData) {
        keyPreparations += 1;
        if (keyPreparations === 1) throw new Error("key service unavailable");
        return localCrypto.prepareSeal(associatedData);
      },
    };
    const skill = fakeCredentialedSkill({
      async acquire() {
        acquisitions += 1;
        return { secret: providerSecret };
      },
    });
    const service = new SourceCredentialsService({
      db: emptyDatabase(),
      actor: ownerActor(),
      claimStore,
      credentialCrypto,
    });

    await expect(service.connect(skill, { claim: replayKey })).rejects.toThrow(
      "key service unavailable",
    );
    expect(acquisitions).toBe(0);

    await expect(service.connect(skill, { claim: replayKey })).resolves.toBeDefined();
    expect(acquisitions).toBe(1);
    expect(inserted).toHaveLength(1);
  });

  test("rejects rate-limited claims before fingerprinting, key preparation, or acquisition", async () => {
    let fingerprints = 0;
    let keyPreparations = 0;
    let acquisitions = 0;
    const localCrypto = createLocalSourceCredentialCrypto(key);
    const credentialCrypto: SourceCredentialCrypto = {
      async fingerprintConnectionClaim(claimProvider, claim) {
        fingerprints += 1;
        return localCrypto.fingerprintConnectionClaim(claimProvider, claim);
      },
      open: (sealed, associatedData) => localCrypto.open(sealed, associatedData),
      async prepareSeal(associatedData) {
        keyPreparations += 1;
        return localCrypto.prepareSeal(associatedData);
      },
    };
    const claimStore: SourceCredentialClaimStore = {
      ...memoryClaimStore([]),
      async assertCanAttempt() {
        throw new Problem(
          429,
          "rate_limited",
          "Too many connection attempts",
          "Wait before submitting another source connection",
        );
      },
    };
    const skill = fakeCredentialedSkill({
      async acquire() {
        acquisitions += 1;
        return { secret: providerSecret };
      },
    });
    const service = new SourceCredentialsService({
      db: emptyDatabase(),
      actor: ownerActor(),
      claimStore,
      credentialCrypto,
    });

    await expect(service.connect(skill, { claim: replayKey })).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
    });
    expect(fingerprints).toBe(0);
    expect(keyPreparations).toBe(0);
    expect(acquisitions).toBe(0);
  });

  test("enforces the installed skill's connection-attempt policy in every claim-store check", async () => {
    const inserted: NewDbSourceCredential[] = [];
    const underlying = memoryClaimStore(inserted);
    const observed: Array<{ attemptLimit: number; windowHours: number }> = [];
    const claimPolicy = {
      kind: "single_use_global" as const,
      attempts: 3,
      windowHours: 24,
    };
    const claimStore: SourceCredentialClaimStore = {
      ...underlying,
      async assertCanAttempt(input) {
        observed.push({ attemptLimit: input.attemptLimit, windowHours: input.windowHours });
        claimPolicy.attempts = 999;
        claimPolicy.windowHours = 720;
        return underlying.assertCanAttempt(input);
      },
      reserve(input) {
        observed.push({ attemptLimit: input.attemptLimit, windowHours: input.windowHours });
        return underlying.reserve(input);
      },
    };
    const service = new SourceCredentialsService({
      db: emptyDatabase(),
      actor: ownerActor(),
      claimStore,
      credentialEncryptionKey: key,
    });

    await service.connect(fakeCredentialedSkill({ claimPolicy }), { claim: replayKey });

    expect(observed).toEqual([
      { attemptLimit: 3, windowHours: 24 },
      { attemptLimit: 3, windowHours: 24 },
    ]);
    expect(inserted).toHaveLength(1);
  });

  test("fails closed on an unsupported runtime claim policy before touching the provider", async () => {
    let preparations = 0;
    let acquisitions = 0;
    const skill = fakeCredentialedSkill({
      onPrepare() {
        preparations += 1;
      },
      async acquire() {
        acquisitions += 1;
        return { secret: providerSecret };
      },
    });
    const unsupported = {
      ...skill,
      connection: {
        ...skill.connection,
        claimPolicy: { kind: "owner_reusable", attempts: 10, windowHours: 1 },
      },
    } as unknown as CredentialSourceConnector;
    const service = new SourceCredentialsService({
      db: emptyDatabase(),
      actor: ownerActor(),
      claimStore: memoryClaimStore([]),
      credentialEncryptionKey: key,
    });

    await expect(service.connect(unsupported, { claim: replayKey })).rejects.toThrow(
      "unsupported claim policy",
    );
    expect(preparations).toBe(0);
    expect(acquisitions).toBe(0);
  });

  test("rejects public credential metadata that is oversized, too deep, or not JSON", async () => {
    const tooDeep: Record<string, unknown> = {};
    let cursor = tooDeep;
    for (let depth = 0; depth < 9; depth += 1) {
      const nested: Record<string, unknown> = {};
      cursor.nested = nested;
      cursor = nested;
    }
    const invalidMetadata = [
      { payload: "x".repeat(16 * 1_024) },
      tooDeep,
      { not_a_number: Number.NaN },
    ];

    for (const [index, publicMetadata] of invalidMetadata.entries()) {
      const inserted: NewDbSourceCredential[] = [];
      const failures: RecordedClaimFailure[] = [];
      const service = new SourceCredentialsService({
        db: emptyDatabase(),
        actor: ownerActor(),
        claimStore: memoryClaimStore(inserted, failures),
        credentialEncryptionKey: key,
      });
      const skill = fakeCredentialedSkill({
        async acquire() {
          return {
            secret: providerSecret,
            publicMetadata: publicMetadata as SourceJsonObject,
          };
        },
      });

      await expect(service.connect(skill, { claim: `${replayKey}-${index}` })).rejects.toThrow(
        "public metadata",
      );
      expect(inserted).toHaveLength(0);
      expect(failures).toContainEqual(
        expect.objectContaining({
          errorCode: "credential_persist_failed",
          status: "ambiguous",
        }),
      );
    }
  });

  test("deduplicates claims across instances with different active rotation keys", async () => {
    const inserted: NewDbSourceCredential[] = [];
    const claimStore = memoryClaimStore(inserted);
    let acquisitions = 0;
    const skill = fakeCredentialedSkill({
      async acquire() {
        acquisitions += 1;
        return { secret: providerSecret };
      },
    });
    const currentKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const rotating = new SourceCredentialsService({
      db: emptyDatabase(),
      actor: ownerActor(),
      claimStore,
      credentialEncryptionKeys: createCredentialKeyring("current", {
        current: currentKey,
        "renamed-previous": key,
      }),
    });
    const legacy = new SourceCredentialsService({
      db: emptyDatabase(),
      actor: ownerActor(),
      claimStore,
      credentialEncryptionKey: key,
    });

    const connected = await rotating.connect(skill, { claim: replayKey });
    expect(await legacy.connect(skill, { claim: replayKey })).toEqual(connected);
    expect(acquisitions).toBe(1);
    expect(inserted).toHaveLength(1);
  });

  test("serializes credentials for skills not installed in the current catalog", () => {
    const credential = storedCredential({
      uuid: "0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b49",
      userUuid: ownerUuid,
      skillId: "uninstalled-provider",
      connectorVersion: "uninstalled-provider-connector@1.0.0",
      secret: new Uint8Array([1, 2, 3]),
    });

    expect(serializeSourceCredential(credential)).toMatchObject({
      skill_id: "uninstalled-provider",
      connector_version: "uninstalled-provider-connector@1.0.0",
      status: "active",
    });
  });
});

interface FakeSkillOptions {
  acquire?: () => Promise<{ secret: string; publicMetadata?: SourceJsonObject }>;
  claimPolicy?: CredentialClaimPolicy;
  fingerprintCompatibility?: readonly CredentialClaimFingerprintCompatibility[];
  onPrepare?: () => void;
}

function fakeCredentialedSkill(options: FakeSkillOptions = {}): CredentialSourceConnector {
  const claimPolicy = options.claimPolicy ?? {
    kind: "single_use_global",
    attempts: 10,
    windowHours: 1,
  };
  return {
    skillId,
    displayName: "Test Provider",
    manifest: {
      skill_id: skillId,
      label: "Test Provider",
      description: "Test credentialed source",
      source_kind: "credentialed_remote",
      connector_version: connectorVersion,
      parser: { name: "csv", version: "test-provider@1.0.0" },
      limits: {
        maxCandidates: 10,
        maxCaptureBytes: 1_024,
        maxElementBytes: 512,
        maxTotalElementBytes: 1_024,
      },
      connection: {
        claim_policy: {
          kind: claimPolicy.kind,
          attempts: claimPolicy.attempts,
          window_hours: claimPolicy.windowHours,
        },
      },
      input_fields: [
        {
          name: "claim",
          label: "Claim",
          target: "connection",
          control: "text",
          required: true,
          secret: true,
        },
      ],
      review_actions: ["review_import", "refresh_source"],
    },
    connection: {
      claimPolicy,
      requestSchema: {
        type: "object",
        required: ["claim"],
        properties: { claim: { type: "string", minLength: 1 } },
        additionalProperties: false,
      },
      prepare(input) {
        options.onPrepare?.();
        if (
          !input ||
          typeof input !== "object" ||
          !("claim" in input) ||
          typeof input.claim !== "string" ||
          !input.claim.trim()
        ) {
          throw new CredentialConnectionError(
            "invalid_connection_details",
            "rejected",
            "Connection details are invalid",
          );
        }
        return {
          replayKey: input.claim.trim(),
          ...(options.fingerprintCompatibility
            ? { fingerprintCompatibility: options.fingerprintCompatibility }
            : {}),
          acquire: options.acquire ?? (async () => ({ secret: providerSecret })),
        };
      },
    },
  };
}

interface RecordedClaimFailure {
  attemptUuid: string;
  errorCode: string;
  ownerUuid: string;
  status: "ambiguous" | "rejected";
}

function memoryClaimStore(
  inserted: NewDbSourceCredential[],
  failures: RecordedClaimFailure[] = [],
): SourceCredentialClaimStore {
  const attempts = new Map<
    string,
    {
      attemptUuid: string;
      credential?: DbSourceCredential;
      status: "ambiguous" | "claiming" | "rejected" | "succeeded";
    }
  >();
  return {
    async assertCanAttempt() {},
    async reserve({ fingerprints, skillId: claimSkillId }) {
      const keys = fingerprints.all.map((fingerprint) => `${claimSkillId}:${fingerprint}`);
      const existing = keys
        .map((fingerprint) => attempts.get(fingerprint))
        .find((attempt) => attempt !== undefined);
      if (existing?.status === "succeeded" && existing.credential) {
        return { kind: "existing", credential: existing.credential };
      }
      if (existing) throw new Error("claim already consumed");
      const attemptUuid = `attempt-${attempts.size + 1}`;
      const attempt = { attemptUuid, status: "claiming" as const };
      for (const fingerprint of keys) attempts.set(fingerprint, attempt);
      return { kind: "reserved", attemptUuid };
    },
    async fail(input) {
      failures.push(input);
      for (const attempt of attempts.values()) {
        if (attempt.attemptUuid === input.attemptUuid) attempt.status = input.status;
      }
    },
    async release({ attemptUuid }) {
      for (const [fingerprint, attempt] of attempts) {
        if (attempt.attemptUuid === attemptUuid) attempts.delete(fingerprint);
      }
    },
    async succeed({ attemptUuid, credential: candidate }) {
      inserted.push(candidate);
      const credential = storedCredential(candidate);
      for (const attempt of attempts.values()) {
        if (attempt.attemptUuid === attemptUuid) {
          attempt.status = "succeeded";
          attempt.credential = credential;
        }
      }
      return credential;
    },
  };
}

function storedCredential(candidate: NewDbSourceCredential): DbSourceCredential {
  return {
    ...candidate,
    metadata: candidate.metadata ?? null,
    connectedAt: candidate.connectedAt ?? new Date("2026-08-29T00:00:00.000Z"),
    revokedAt: candidate.revokedAt ?? null,
  };
}

function ownerActor() {
  return { kind: "user" as const, uuid: ownerUuid, subject: `id:rnet://id/${ownerUuid}` };
}

function emptyDatabase(): Database {
  return {} as Database;
}
