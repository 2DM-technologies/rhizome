import { describe, expect, test } from "bun:test";
import { SIMPLEFIN_PROVIDER } from "@rhizome/store-contract";

import type { Database } from "../src/db/index.ts";
import type {
  DbSourceCredential,
  NewDbSourceCredential,
} from "../src/db/models/source-credential.ts";
import { Problem } from "../src/errors.ts";
import { SimpleFinClient } from "../src/services/simplefin-client.ts";
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
const key = Uint8Array.from({ length: 32 }, (_, index) => index);
const claimUrl = "https://bridge.simplefin.test/claim/once";
const setupToken = Buffer.from(claimUrl).toString("base64");
const accessUrl = "https://alice:very-secret@bridge.simplefin.test/simplefin";

describe("source credential service", () => {
  test("persists only owner-bound ciphertext and returns a non-secret document", async () => {
    const inserted: NewDbSourceCredential[] = [];
    let exchanges = 0;
    const simpleFin = new SimpleFinClient({
      allowedHosts: ["bridge.simplefin.test"],
      fetch: async () => {
        exchanges += 1;
        return new Response(accessUrl);
      },
    });
    const claimStore = memoryClaimStore(inserted);
    const service = new SourceCredentialsService({
      db: insertionDatabase(inserted),
      actor: { kind: "user", uuid: ownerUuid, subject: `id:rnet://id/${ownerUuid}` },
      claimStore,
      credentialEncryptionKey: key,
      simpleFin,
    });

    const credential = await service.connectSimpleFin({ setup_token: setupToken });
    expect(await service.connectSimpleFin({ setup_token: setupToken })).toEqual(credential);
    expect(await service.connectSimpleFin({ setup_token: setupToken.replace(/=+$/, "") })).toEqual(
      credential,
    );
    expect(exchanges).toBe(1);
    expect(inserted).toHaveLength(1);
    const stored = inserted[0]!;
    expect(stored.userUuid).toBe(ownerUuid);
    expect(stored.provider).toBe(SIMPLEFIN_PROVIDER);
    expect(new TextDecoder().decode(stored.secret)).not.toContain("very-secret");
    expect(JSON.stringify(stored)).not.toContain(setupToken);
    expect(
      await openCredentialSecret(
        stored.secret,
        key,
        credentialAssociatedData(credential.uuid, ownerUuid, SIMPLEFIN_PROVIDER),
      ),
    ).toBe(accessUrl);

    const document = serializeSourceCredential(credential);
    expect(document).toMatchObject({ provider: SIMPLEFIN_PROVIDER, status: "active" });
    expect(JSON.stringify(document)).not.toContain("very-secret");
    expect(JSON.stringify(document)).not.toContain(accessUrl);
  });

  test("rejects clients before exchange and preserves compromised-token guidance", async () => {
    let exchanges = 0;
    const simpleFin = new SimpleFinClient({
      allowedHosts: ["bridge.simplefin.test"],
      fetch: async () => {
        exchanges += 1;
        return new Response(null, { status: 403 });
      },
    });
    const inserted: NewDbSourceCredential[] = [];
    const db = insertionDatabase(inserted);
    const claimStore = memoryClaimStore(inserted);
    const clientService = new SourceCredentialsService({
      db,
      actor: {
        kind: "client",
        uuid: "0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b48",
        name: "rbudget",
        subject: "client:rbudget",
      },
      claimStore,
      credentialEncryptionKey: key,
      simpleFin,
    });
    await expect(clientService.connectSimpleFin({ setup_token: setupToken })).rejects.toMatchObject(
      { status: 403, code: "grant_missing" },
    );
    expect(exchanges).toBe(0);

    const ownerService = new SourceCredentialsService({
      db,
      actor: { kind: "user", uuid: ownerUuid, subject: `id:rnet://id/${ownerUuid}` },
      claimStore,
      credentialEncryptionKey: key,
      simpleFin,
    });
    let failure: unknown;
    try {
      await ownerService.connectSimpleFin({ setup_token: setupToken });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Problem);
    expect(failure).toMatchObject({
      status: 422,
      code: "source_connection_failed",
      detail: expect.stringContaining("compromised"),
    });
    expect((failure as Error).message).toContain("disable");
    expect((failure as Error).message).not.toContain(setupToken);
    expect(inserted).toHaveLength(0);
  });

  test("prepares credential protection before consuming the one-time provider token", async () => {
    const inserted: NewDbSourceCredential[] = [];
    const claimStore = memoryClaimStore(inserted);
    const localCrypto = createLocalSourceCredentialCrypto(key);
    let prepares = 0;
    let exchanges = 0;
    const credentialCrypto: SourceCredentialCrypto = {
      fingerprintSetupToken: (token) => localCrypto.fingerprintSetupToken(token),
      open: (sealed, associatedData) => localCrypto.open(sealed, associatedData),
      async prepareSeal(associatedData) {
        prepares += 1;
        if (prepares === 1) throw new Error("key service unavailable");
        return localCrypto.prepareSeal(associatedData);
      },
    };
    const service = new SourceCredentialsService({
      db: insertionDatabase(inserted),
      actor: { kind: "user", uuid: ownerUuid, subject: `id:rnet://id/${ownerUuid}` },
      claimStore,
      credentialCrypto,
      simpleFin: new SimpleFinClient({
        allowedHosts: ["bridge.simplefin.test"],
        fetch: async () => {
          exchanges += 1;
          return new Response(accessUrl);
        },
      }),
    });

    await expect(service.connectSimpleFin({ setup_token: setupToken })).rejects.toThrow(
      "key service unavailable",
    );
    expect(exchanges).toBe(0);

    await expect(service.connectSimpleFin({ setup_token: setupToken })).resolves.toBeDefined();
    expect(exchanges).toBe(1);
    expect(inserted).toHaveLength(1);
  });

  test("rejects rate-limited claims before fingerprinting, key preparation, or provider exchange", async () => {
    const inserted: NewDbSourceCredential[] = [];
    const backingClaimStore = memoryClaimStore(inserted);
    let fingerprints = 0;
    let keyPreparations = 0;
    let exchanges = 0;
    const localCrypto = createLocalSourceCredentialCrypto(key);
    const credentialCrypto: SourceCredentialCrypto = {
      async fingerprintSetupToken(token) {
        fingerprints += 1;
        return localCrypto.fingerprintSetupToken(token);
      },
      open: (sealed, associatedData) => localCrypto.open(sealed, associatedData),
      async prepareSeal(associatedData) {
        keyPreparations += 1;
        return localCrypto.prepareSeal(associatedData);
      },
    };
    const claimStore: SourceCredentialClaimStore = {
      ...backingClaimStore,
      async assertCanAttempt() {
        throw new Problem(
          429,
          "rate_limited",
          "Too many connection attempts",
          "Wait before submitting another SimpleFIN setup token",
        );
      },
    };
    const service = new SourceCredentialsService({
      db: insertionDatabase(inserted),
      actor: { kind: "user", uuid: ownerUuid, subject: `id:rnet://id/${ownerUuid}` },
      claimStore,
      credentialCrypto,
      simpleFin: {
        canonicalizeSetupToken: () => claimUrl,
        async claimSetupToken() {
          exchanges += 1;
          return accessUrl;
        },
      },
    });

    await expect(service.connectSimpleFin({ setup_token: setupToken })).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
    });
    expect(fingerprints).toBe(0);
    expect(keyPreparations).toBe(0);
    expect(exchanges).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  test("deduplicates claims across instances with different active rotation keys", async () => {
    const inserted: NewDbSourceCredential[] = [];
    const claimStore = memoryClaimStore(inserted);
    let exchanges = 0;
    const simpleFin = new SimpleFinClient({
      allowedHosts: ["bridge.simplefin.test"],
      fetch: async () => {
        exchanges += 1;
        return new Response(accessUrl);
      },
    });
    const actor = { kind: "user" as const, uuid: ownerUuid, subject: `id:rnet://id/${ownerUuid}` };
    const currentKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const rotating = new SourceCredentialsService({
      db: insertionDatabase(inserted),
      actor,
      claimStore,
      credentialEncryptionKeys: createCredentialKeyring("current", {
        current: currentKey,
        "renamed-previous": key,
      }),
      simpleFin,
    });
    const legacy = new SourceCredentialsService({
      db: insertionDatabase(inserted),
      actor,
      claimStore,
      credentialEncryptionKey: key,
      simpleFin,
    });

    const connected = await rotating.connectSimpleFin({ setup_token: setupToken });
    expect(await legacy.connectSimpleFin({ setup_token: setupToken })).toEqual(connected);
    expect(exchanges).toBe(1);
    expect(inserted).toHaveLength(1);
  });
});

function memoryClaimStore(inserted: NewDbSourceCredential[]): SourceCredentialClaimStore {
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
    async reserve({ fingerprints }) {
      const existing = fingerprints.all
        .map((fingerprint) => attempts.get(fingerprint))
        .find((attempt) => attempt !== undefined);
      if (existing?.status === "succeeded" && existing.credential) {
        return { kind: "existing", credential: existing.credential };
      }
      if (existing) throw new Error("claim already consumed");
      const attemptUuid = `attempt-${attempts.size + 1}`;
      const attempt = { attemptUuid, status: "claiming" as const };
      for (const fingerprint of fingerprints.all) attempts.set(fingerprint, attempt);
      return { kind: "reserved", attemptUuid };
    },
    async fail({ attemptUuid, status }) {
      for (const attempt of attempts.values()) {
        if (attempt.attemptUuid === attemptUuid) attempt.status = status;
      }
    },
    async release({ attemptUuid }) {
      for (const [fingerprint, attempt] of attempts) {
        if (attempt.attemptUuid === attemptUuid) attempts.delete(fingerprint);
      }
    },
    async succeed({ attemptUuid, credential: candidate }) {
      inserted.push(candidate);
      const credential: DbSourceCredential = {
        ...candidate,
        metadata: candidate.metadata ?? null,
        connectedAt: candidate.connectedAt ?? new Date("2026-08-29T00:00:00.000Z"),
        revokedAt: candidate.revokedAt ?? null,
      };
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

function insertionDatabase(inserted: NewDbSourceCredential[]): Database {
  return {
    insert() {
      return {
        values(candidate: NewDbSourceCredential) {
          inserted.push(candidate);
          return {
            async returning(): Promise<DbSourceCredential[]> {
              return [
                {
                  ...candidate,
                  metadata: candidate.metadata ?? null,
                  connectedAt: candidate.connectedAt ?? new Date("2026-08-29T00:00:00.000Z"),
                  revokedAt: candidate.revokedAt ?? null,
                },
              ];
            },
          };
        },
      };
    },
  } as unknown as Database;
}
