import { describe, expect, test } from "bun:test";

import {
  createCredentialKeyring,
  credentialAssociatedData,
  decodeCredentialEncryptionKey,
  fingerprintCredentialSetupToken,
  openCredentialSecret,
  sealCredentialSecret,
} from "../src/services/source-credential-crypto.ts";

const key = Uint8Array.from({ length: 32 }, (_, index) => index);
const otherKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const associatedData = credentialAssociatedData(
  "0198f2a1-f5d0-7bee-aacd-4ba0aa096e07",
  "0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47",
  "simplefin",
);

describe("source credential encryption", () => {
  test("round-trips a secret through randomized authenticated encryption", async () => {
    const secret = "https://user:password@example.test/simplefin";
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

  test("HMAC-fingerprints setup tokens across active and legacy keys", async () => {
    const keyring = createCredentialKeyring("current", { current: otherKey, previous: key });
    const fingerprints = await fingerprintCredentialSetupToken(" secret-token ", keyring);
    const same = await fingerprintCredentialSetupToken("secret-token", keyring);
    expect(fingerprints).toEqual(same);
    expect(fingerprints.all).toHaveLength(2);
    expect(fingerprints.active).toMatch(/^hmac-sha256-hkdf-v1:[a-f0-9]{64}$/);
    expect(JSON.stringify(fingerprints)).not.toContain("secret-token");
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
