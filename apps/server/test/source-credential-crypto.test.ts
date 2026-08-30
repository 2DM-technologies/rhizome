import { describe, expect, test } from "bun:test";

import {
  createCredentialKeyring,
  credentialAssociatedData,
  decodeCredentialEncryptionKey,
  fingerprintCredentialConnectionClaim,
  openCredentialSecret,
  sealCredentialSecret,
} from "../src/services/source-credential-crypto.ts";

const key = Uint8Array.from({ length: 32 }, (_, index) => index);
const otherKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const associatedData = credentialAssociatedData(
  "0198f2a1-f5d0-7bee-aacd-4ba0aa096e07",
  "0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47",
  "test-provider",
);

describe("source credential encryption", () => {
  test("round-trips a secret through randomized authenticated encryption", async () => {
    const secret = "opaque-provider-secret";
    const first = await sealCredentialSecret(secret, key, associatedData);
    const second = await sealCredentialSecret(secret, key, associatedData);

    expect(first).not.toEqual(second);
    expect(new TextDecoder().decode(first)).not.toContain("password");
    expect(await openCredentialSecret(first, key, associatedData)).toBe(secret);
    expect(await openCredentialSecret(second, key, associatedData)).toBe(secret);
  });

  test("rejects ciphertext moved to another credential or opened with another key", async () => {
    const sealed = await sealCredentialSecret("access-url", key, associatedData);
    await expect(openCredentialSecret(sealed, key, `${associatedData}:other`)).rejects.toThrow();
    await expect(openCredentialSecret(sealed, otherKey, associatedData)).rejects.toThrow();
  });

  test("rejects malformed envelopes and invalid configured keys", async () => {
    await expect(openCredentialSecret(Uint8Array.of(1), key, associatedData)).rejects.toThrow(
      "envelope is invalid",
    );
    expect(decodeCredentialEncryptionKey(Buffer.from(key).toString("base64"))).toEqual(key);
    expect(() => decodeCredentialEncryptionKey("too-short")).toThrow("exactly 32 bytes");
    await expect(sealCredentialSecret("secret", Uint8Array.of(1), associatedData)).rejects.toThrow(
      "must be 32 bytes",
    );
  });

  test("records a key id and keeps v1 ciphertext readable during rotation", async () => {
    const keyring = createCredentialKeyring("current", { current: otherKey, previous: key });
    const sealed = await sealCredentialSecret("rotated-secret", keyring, associatedData);
    expect(sealed[0]).toBe(2);
    expect(await openCredentialSecret(sealed, keyring, associatedData)).toBe("rotated-secret");
    await expect(
      openCredentialSecret(
        sealed,
        createCredentialKeyring("previous", { previous: key }),
        associatedData,
      ),
    ).rejects.toThrow("unavailable: current");

    const legacy = await sealLegacyCredentialSecret("legacy-secret", key, associatedData);
    expect(legacy[0]).toBe(1);
    expect(await openCredentialSecret(legacy, keyring, associatedData)).toBe("legacy-secret");
  });

  test("HMAC-fingerprints provider-scoped replay keys across active and legacy keys", async () => {
    const keyring = createCredentialKeyring("current", { current: otherKey, previous: key });
    const fingerprints = await fingerprintCredentialConnectionClaim(
      "test-provider",
      "canonical-claim",
      keyring,
    );
    const same = await fingerprintCredentialConnectionClaim(
      "test-provider",
      "canonical-claim",
      keyring,
    );
    expect(fingerprints).toEqual(same);
    expect(
      await fingerprintCredentialConnectionClaim("other-provider", "canonical-claim", keyring),
    ).not.toEqual(fingerprints);
    expect(fingerprints.all).toHaveLength(2);
    expect(fingerprints.active).toMatch(/^hmac-sha256-hkdf-v1:[a-f0-9]{64}$/);
    expect(JSON.stringify(fingerprints)).not.toContain("canonical-claim");
  });

  test("adds skill-owned compatibility aliases for every local key", async () => {
    const keyring = createCredentialKeyring("current", { current: otherKey, previous: key });
    const current = await fingerprintCredentialConnectionClaim(
      "test-provider",
      "canonical-one-time-claim",
      keyring,
    );
    const fingerprints = await fingerprintCredentialConnectionClaim(
      "test-provider",
      "canonical-one-time-claim",
      keyring,
      [
        {
          claim: "legacy-canonical-claim",
          localHkdfInfo: "rhizome:test-provider-claim-fingerprint:v0",
          kmsDigestDomain: "rhizome:test-provider-claim-fingerprint:kms-v0",
        },
      ],
    );

    expect(fingerprints.all[0]).toBe(fingerprints.active);
    expect(fingerprints.all.slice(0, current.all.length)).toEqual([...current.all]);
    expect(fingerprints.all).toHaveLength(4);
    expect(fingerprints.all.slice(current.all.length)).toEqual([
      "hmac-sha256-hkdf-v1:0e7cee77989137acc0e2e0bb42f5002d03a7ee4ca4d2e215cb3e7696eb1ce36c",
      "hmac-sha256-hkdf-v1:385a3c9c61a60bd520a862c1e66c9de5ac57ca3b45b5cd662d41810790269271",
    ]);
    expect(JSON.stringify(fingerprints)).not.toContain("legacy-canonical-claim");
  });

  test("rejects invalid skill-owned fingerprint compatibility profiles", async () => {
    await expect(
      fingerprintCredentialConnectionClaim("test-provider", "claim", key, [
        {
          claim: "legacy-claim",
          localHkdfInfo: " invalid-domain",
          kmsDigestDomain: "rhizome:test-provider:kms-v0",
        },
      ]),
    ).rejects.toThrow("compatibility profile is invalid");
  });
});

async function sealLegacyCredentialSecret(
  secret: string,
  keyBytes: Uint8Array,
  additionalData: string,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(keyBytes), "AES-GCM", false, [
    "encrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(additionalData),
    },
    key,
    new TextEncoder().encode(secret),
  );
  const sealed = new Uint8Array(1 + iv.byteLength + ciphertext.byteLength);
  sealed[0] = 1;
  sealed.set(iv, 1);
  sealed.set(new Uint8Array(ciphertext), 1 + iv.byteLength);
  return sealed;
}
