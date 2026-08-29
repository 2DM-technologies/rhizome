import { describe, expect, test } from "bun:test";
import type {
  DecryptCommandInput,
  DecryptCommandOutput,
  GenerateDataKeyCommandInput,
  GenerateDataKeyCommandOutput,
  GenerateMacCommandInput,
  GenerateMacCommandOutput,
} from "@aws-sdk/client-kms";

import {
  createCredentialKeyring,
  sealCredentialSecret,
} from "../src/services/source-credential-crypto.ts";
import {
  AwsKmsSourceCredentialCrypto,
  CredentialKeyServiceError,
  type CredentialKms,
} from "../src/services/source-credential-kms-crypto.ts";

const wrappingKeyAlias = "alias/rhizome-credential-encryption";
const wrappingKeyArn =
  "arn:aws:kms:us-east-1:111122223333:key/12345678-1234-1234-1234-123456789012";
const activeFingerprintKey =
  "arn:aws:kms:us-east-1:111122223333:key/aaaaaaaa-1234-1234-1234-123456789012";
const previousFingerprintKey =
  "arn:aws:kms:us-east-1:111122223333:key/bbbbbbbb-1234-1234-1234-123456789012";
const associatedData = "rhizome:source-credential:v1:credential-uuid:owner-private-uuid:simplefin";
const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

describe("AWS KMS source credential crypto", () => {
  test("rejects mutable aliases for replay-fingerprint HMAC keys", () => {
    expect(
      () =>
        new AwsKmsSourceCredentialCrypto({
          encryptionKeyId: wrappingKeyAlias,
          fingerprintKeyIds: ["alias/rhizome-token-hmac-current"],
          kms: new FakeCredentialKms(),
        }),
    ).toThrow("immutable key ids or key ARNs");
  });

  test("stores a v3 wrapped-data-key envelope and binds both KMS and AES-GCM to the row", async () => {
    const kms = new FakeCredentialKms();
    const credentialCrypto = createKmsCrypto(kms);

    const prepared = await credentialCrypto.prepareSeal(associatedData);
    expect(kms.generatedPlaintexts[0]).toEqual(new Uint8Array(32));
    const sealed = await prepared.seal("https://alice:very-secret@bridge.simplefin.test/simplefin");

    expect(sealed[0]).toBe(3);
    expect(new TextDecoder().decode(sealed)).not.toContain("very-secret");
    expect(await credentialCrypto.open(sealed, associatedData)).toContain("very-secret");
    expect(kms.decryptInputs[0]?.KeyId).toBe(wrappingKeyArn);
    expect(kms.decryptInputs[0]?.EncryptionContext).toEqual(
      kms.generateDataKeyInputs[0]?.EncryptionContext,
    );
    expect(JSON.stringify(kms.generateDataKeyInputs[0]?.EncryptionContext)).not.toContain(
      "owner-private-uuid",
    );
    expect(kms.decryptedPlaintexts[0]).toEqual(new Uint8Array(32));

    await expect(credentialCrypto.open(sealed, `${associatedData}:other-row`)).rejects.toThrow();
    const tampered = sealed.slice();
    tampered[tampered.length - 1] = (tampered.at(-1) ?? 0) ^ 1;
    await expect(credentialCrypto.open(tampered, associatedData)).rejects.toThrow();
  });

  test("uses dedicated active and retained KMS HMAC keys without sending the token to KMS", async () => {
    const kms = new FakeCredentialKms();
    const credentialCrypto = createKmsCrypto(kms);
    const token = "https://bridge.simplefin.test/claim/one-time-secret";

    const first = await credentialCrypto.fingerprintSetupToken(` ${token} `);
    const second = await credentialCrypto.fingerprintSetupToken(token);

    expect(first).toEqual(second);
    expect(first.active).toStartWith("hmac-sha256-kms-v1:");
    expect(first.all).toHaveLength(2);
    expect(kms.generateMacInputs.map(({ KeyId }) => KeyId).slice(0, 2)).toEqual([
      activeFingerprintKey,
      previousFingerprintKey,
    ]);
    for (const input of kms.generateMacInputs) {
      expect(input.Message).toHaveLength(32);
      expect(new TextDecoder().decode(input.Message)).not.toContain("one-time-secret");
    }
  });

  test("reads v1/v2 local envelopes during migration while every new write is v3", async () => {
    const legacyKey = Uint8Array.from({ length: 32 }, (_, index) => 31 - index);
    const legacyKeyring = createCredentialKeyring("legacy", { legacy: legacyKey });
    const legacyEnvelope = await sealCredentialSecret(
      "legacy-access-url",
      legacyKeyring,
      associatedData,
    );
    const kms = new FakeCredentialKms();
    const credentialCrypto = new AwsKmsSourceCredentialCrypto({
      encryptionKeyId: wrappingKeyAlias,
      fingerprintKeyIds: [activeFingerprintKey],
      kms,
      legacyEncryptionKeys: legacyKeyring,
    });

    expect(await credentialCrypto.open(legacyEnvelope, associatedData)).toBe("legacy-access-url");
    expect(kms.decryptInputs).toHaveLength(0);
    const prepared = await credentialCrypto.prepareSeal(associatedData);
    expect((await prepared.seal("new-access-url"))[0]).toBe(3);
    expect((await credentialCrypto.fingerprintSetupToken("token")).all).toHaveLength(2);
  });

  test("fails closed on malformed envelopes and invalid or unavailable KMS responses", async () => {
    const kms = new FakeCredentialKms();
    const credentialCrypto = createKmsCrypto(kms);

    await expect(credentialCrypto.open(Uint8Array.of(3), associatedData)).rejects.toThrow(
      "Credential secret envelope is invalid",
    );
    await expect(credentialCrypto.open(Uint8Array.of(2), associatedData)).rejects.toThrow(
      "Credential secret envelope is invalid",
    );
    expect(kms.decryptInputs).toHaveLength(0);

    const unavailable = createKmsCrypto({
      decrypt: (input) => kms.decrypt(input),
      generateDataKey: async () => {
        throw new Error("provider detail must stay internal");
      },
      generateMac: (input) => kms.generateMac(input),
    });
    let failure: unknown;
    try {
      await unavailable.prepareSeal(associatedData);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(CredentialKeyServiceError);
    expect((failure as Error).message).toBe(
      "Credential key service could not complete the request",
    );
    expect((failure as Error).message).not.toContain("provider detail");

    const invalidResponse = createKmsCrypto({
      decrypt: (input) => kms.decrypt(input),
      async generateDataKey() {
        return {
          $metadata: {},
          CiphertextBlob: Uint8Array.of(1),
          KeyId: wrappingKeyArn,
        };
      },
      generateMac: (input) => kms.generateMac(input),
    });
    await expect(invalidResponse.prepareSeal(associatedData)).rejects.toThrow("invalid response");
  });
});

function createKmsCrypto(kms: CredentialKms): AwsKmsSourceCredentialCrypto {
  return new AwsKmsSourceCredentialCrypto({
    encryptionKeyId: wrappingKeyAlias,
    fingerprintKeyIds: [activeFingerprintKey, previousFingerprintKey],
    kms,
  });
}

class FakeCredentialKms implements CredentialKms {
  readonly decryptInputs: DecryptCommandInput[] = [];
  readonly decryptedPlaintexts: Uint8Array[] = [];
  readonly generateDataKeyInputs: GenerateDataKeyCommandInput[] = [];
  readonly generatedPlaintexts: Uint8Array[] = [];
  readonly generateMacInputs: GenerateMacCommandInput[] = [];

  async generateDataKey(input: GenerateDataKeyCommandInput): Promise<GenerateDataKeyCommandOutput> {
    this.generateDataKeyInputs.push({
      ...input,
      ...(input.EncryptionContext ? { EncryptionContext: { ...input.EncryptionContext } } : {}),
    });
    const plaintext = Uint8Array.from(dataKey);
    this.generatedPlaintexts.push(plaintext);
    return {
      $metadata: {},
      CiphertextBlob: Uint8Array.of(0x72, 0x68, 0x69, 0x7a, 0x6f, 0x6d, 0x65),
      KeyId: wrappingKeyArn,
      Plaintext: plaintext,
    };
  }

  async decrypt(input: DecryptCommandInput): Promise<DecryptCommandOutput> {
    this.decryptInputs.push({
      ...input,
      ...(input.EncryptionContext ? { EncryptionContext: { ...input.EncryptionContext } } : {}),
      ...(input.CiphertextBlob ? { CiphertextBlob: Uint8Array.from(input.CiphertextBlob) } : {}),
    });
    const plaintext = Uint8Array.from(dataKey);
    this.decryptedPlaintexts.push(plaintext);
    return { $metadata: {}, KeyId: wrappingKeyArn, Plaintext: plaintext };
  }

  async generateMac(input: GenerateMacCommandInput): Promise<GenerateMacCommandOutput> {
    this.generateMacInputs.push({
      ...input,
      ...(input.Message ? { Message: Uint8Array.from(input.Message) } : {}),
    });
    const keySeed = input.KeyId === activeFingerprintKey ? 17 : 29;
    const hmacKey = await crypto.subtle.importKey(
      "raw",
      Uint8Array.from({ length: 32 }, (_, index) => keySeed + index),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", hmacKey, Uint8Array.from(input.Message ?? []));
    return {
      $metadata: {},
      KeyId: input.KeyId,
      Mac: new Uint8Array(mac),
      MacAlgorithm: "HMAC_SHA_256",
    };
  }
}
