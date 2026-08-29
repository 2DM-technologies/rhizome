import {
  DecryptCommand,
  GenerateDataKeyCommand,
  GenerateMacCommand,
  KMSClient,
  type DecryptCommandInput,
  type DecryptCommandOutput,
  type GenerateDataKeyCommandInput,
  type GenerateDataKeyCommandOutput,
  type GenerateMacCommandInput,
  type GenerateMacCommandOutput,
} from "@aws-sdk/client-kms";

import {
  createLocalSourceCredentialCrypto,
  type CredentialEncryptionKeys,
  type CredentialTokenFingerprints,
  type PreparedCredentialSecretSeal,
  type SourceCredentialCrypto,
} from "./source-credential-crypto.ts";

const AES_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const KMS_ENVELOPE_VERSION = 3;
const KMS_ENVELOPE_HEADER_BYTES = 7;
const MAX_KMS_KEY_ID_BYTES = 2_048;
const MAX_KMS_CIPHERTEXT_BLOB_BYTES = 6_144;
const MAX_LOCAL_CIPHERTEXT_BYTES = 64 * 1_024;
const FINGERPRINT_DOMAIN = "rhizome:simplefin-setup-token-fingerprint:kms-v1";

export interface CredentialKms {
  decrypt(input: DecryptCommandInput): Promise<DecryptCommandOutput>;
  generateDataKey(input: GenerateDataKeyCommandInput): Promise<GenerateDataKeyCommandOutput>;
  generateMac(input: GenerateMacCommandInput): Promise<GenerateMacCommandOutput>;
}

export interface AwsKmsSourceCredentialCryptoOptions {
  encryptionKeyId: string;
  fingerprintKeyIds: readonly string[];
  kms: CredentialKms;
  legacyEncryptionKeys?: CredentialEncryptionKeys;
}

export interface AwsKmsTransportOptions {
  region: string;
  requestTimeoutMs: number;
}

export class CredentialKeyServiceError extends Error {
  constructor(cause?: unknown) {
    super("Credential key service could not complete the request", { cause });
    this.name = "CredentialKeyServiceError";
  }
}

export function createAwsKmsTransport(options: AwsKmsTransportOptions): CredentialKms {
  const client = new KMSClient({
    region: options.region,
    maxAttempts: 3,
    retryMode: "standard",
  });
  return {
    decrypt: (input) =>
      sendWithDeadline(
        (abortSignal) => client.send(new DecryptCommand(input), { abortSignal }),
        options.requestTimeoutMs,
      ),
    generateDataKey: (input) =>
      sendWithDeadline(
        (abortSignal) => client.send(new GenerateDataKeyCommand(input), { abortSignal }),
        options.requestTimeoutMs,
      ),
    generateMac: (input) =>
      sendWithDeadline(
        (abortSignal) => client.send(new GenerateMacCommand(input), { abortSignal }),
        options.requestTimeoutMs,
      ),
  };
}

export class AwsKmsSourceCredentialCrypto implements SourceCredentialCrypto {
  readonly #encryptionKeyId: string;
  readonly #fingerprintKeyIds: readonly string[];
  readonly #kms: CredentialKms;
  readonly #legacy?: SourceCredentialCrypto;

  constructor(options: AwsKmsSourceCredentialCryptoOptions) {
    assertKmsKeyId(options.encryptionKeyId);
    if (options.fingerprintKeyIds.length === 0) {
      throw new Error("At least one credential fingerprint KMS key is required");
    }
    for (const keyId of options.fingerprintKeyIds) {
      assertKmsKeyId(keyId);
      if (isKmsAlias(keyId)) {
        throw new Error(
          "Credential fingerprint KMS keys must use immutable key ids or key ARNs, not aliases",
        );
      }
    }
    if (new Set(options.fingerprintKeyIds).size !== options.fingerprintKeyIds.length) {
      throw new Error("Credential fingerprint KMS key ids must be unique");
    }
    this.#encryptionKeyId = options.encryptionKeyId;
    this.#fingerprintKeyIds = [...options.fingerprintKeyIds];
    this.#kms = options.kms;
    this.#legacy = options.legacyEncryptionKeys
      ? createLocalSourceCredentialCrypto(options.legacyEncryptionKeys)
      : undefined;
  }

  async prepareSeal(associatedData: string): Promise<PreparedCredentialSecretSeal> {
    const encryptionContext = await credentialKmsEncryptionContext(associatedData);
    const response = await this.#callKms(() =>
      this.#kms.generateDataKey({
        KeyId: this.#encryptionKeyId,
        KeySpec: "AES_256",
        EncryptionContext: encryptionContext,
      }),
    );
    const plaintext = response.Plaintext;
    try {
      if (!plaintext || plaintext.byteLength !== AES_KEY_BYTES) throw invalidKmsResponse();
      if (
        !response.CiphertextBlob ||
        response.CiphertextBlob.byteLength === 0 ||
        response.CiphertextBlob.byteLength > MAX_KMS_CIPHERTEXT_BLOB_BYTES ||
        !response.KeyId
      ) {
        throw invalidKmsResponse();
      }
      try {
        assertKmsKeyId(response.KeyId);
      } catch {
        throw invalidKmsResponse();
      }
      const wrappingKeyId = response.KeyId;
      const encryptedDataKey = Uint8Array.from(response.CiphertextBlob);
      const key = await importAesKey(plaintext, ["encrypt"]);
      return preparedKmsSeal(key, wrappingKeyId, encryptedDataKey, associatedData);
    } finally {
      plaintext?.fill(0);
    }
  }

  async open(sealed: Uint8Array, associatedData: string): Promise<string> {
    if (sealed[0] !== KMS_ENVELOPE_VERSION) {
      if (this.#legacy) return this.#legacy.open(sealed, associatedData);
      throw invalidEnvelope();
    }
    const envelope = parseKmsEnvelope(sealed);
    return this.#openEnvelope(envelope, associatedData);
  }

  async fingerprintSetupToken(setupToken: string): Promise<CredentialTokenFingerprints> {
    const token = setupToken.trim();
    const message = await fingerprintMessage(token);
    const kmsFingerprints = await Promise.all(
      this.#fingerprintKeyIds.map(async (keyId) => {
        const response = await this.#callKms(() =>
          this.#kms.generateMac({
            KeyId: keyId,
            MacAlgorithm: "HMAC_SHA_256",
            Message: message,
          }),
        );
        if (!response.Mac || response.Mac.byteLength !== 32) throw invalidKmsResponse();
        return `hmac-sha256-kms-v1:${Buffer.from(response.Mac).toString("hex")}`;
      }),
    );
    const legacyFingerprints = this.#legacy
      ? await this.#legacy.fingerprintSetupToken(token)
      : undefined;
    const all = [...new Set([...kmsFingerprints, ...(legacyFingerprints?.all ?? [])])];
    const active = kmsFingerprints[0];
    if (!active) throw new Error("Active credential fingerprint KMS key is unavailable");
    return { active, all };
  }

  async #callKms<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof CredentialKeyServiceError) throw error;
      throw new CredentialKeyServiceError(error);
    }
  }

  async #openEnvelope(envelope: KmsEnvelope, associatedData: string): Promise<string> {
    const encryptionContext = await credentialKmsEncryptionContext(associatedData);
    const response = await this.#callKms(() =>
      this.#kms.decrypt({
        CiphertextBlob: envelope.encryptedDataKey,
        KeyId: envelope.wrappingKeyId,
        EncryptionContext: encryptionContext,
      }),
    );
    const plaintextKey = response.Plaintext;
    try {
      if (!plaintextKey || plaintextKey.byteLength !== AES_KEY_BYTES) {
        throw invalidKmsResponse();
      }
      const key = await importAesKey(plaintextKey, ["decrypt"]);
      const plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: Uint8Array.from(envelope.iv),
          additionalData: new TextEncoder().encode(associatedData),
        },
        key,
        Uint8Array.from(envelope.ciphertext),
      );
      return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    } finally {
      plaintextKey?.fill(0);
    }
  }
}

interface KmsEnvelope {
  ciphertext: Uint8Array;
  encryptedDataKey: Uint8Array;
  iv: Uint8Array;
  wrappingKeyId: string;
}

function preparedKmsSeal(
  importedKey: CryptoKey,
  wrappingKeyId: string,
  encryptedDataKey: Uint8Array,
  associatedData: string,
): PreparedCredentialSecretSeal {
  let key: CryptoKey | undefined = importedKey;
  return {
    destroy() {
      key = undefined;
    },
    async seal(secret) {
      const sealingKey = key;
      key = undefined;
      if (!sealingKey) throw new Error("Prepared credential secret seal is unavailable");
      if (!secret) throw new Error("Credential secret cannot be empty");
      const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
      const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
          {
            name: "AES-GCM",
            iv,
            additionalData: new TextEncoder().encode(associatedData),
          },
          sealingKey,
          new TextEncoder().encode(secret),
        ),
      );
      if (ciphertext.byteLength > MAX_LOCAL_CIPHERTEXT_BYTES) throw invalidEnvelope();
      return serializeKmsEnvelope({
        ciphertext,
        encryptedDataKey,
        iv,
        wrappingKeyId,
      });
    },
  };
}

function serializeKmsEnvelope(envelope: KmsEnvelope): Uint8Array {
  const encodedKeyId = new TextEncoder().encode(envelope.wrappingKeyId);
  const output = new Uint8Array(
    KMS_ENVELOPE_HEADER_BYTES +
      encodedKeyId.byteLength +
      envelope.encryptedDataKey.byteLength +
      envelope.iv.byteLength +
      envelope.ciphertext.byteLength,
  );
  const view = new DataView(output.buffer);
  output[0] = KMS_ENVELOPE_VERSION;
  view.setUint16(1, encodedKeyId.byteLength);
  view.setUint32(3, envelope.encryptedDataKey.byteLength);
  let offset = KMS_ENVELOPE_HEADER_BYTES;
  output.set(encodedKeyId, offset);
  offset += encodedKeyId.byteLength;
  output.set(envelope.encryptedDataKey, offset);
  offset += envelope.encryptedDataKey.byteLength;
  output.set(envelope.iv, offset);
  output.set(envelope.ciphertext, offset + envelope.iv.byteLength);
  return output;
}

function parseKmsEnvelope(sealed: Uint8Array): KmsEnvelope {
  if (
    sealed.byteLength < KMS_ENVELOPE_HEADER_BYTES + 1 + 1 + GCM_IV_BYTES + GCM_TAG_BYTES ||
    sealed[0] !== KMS_ENVELOPE_VERSION
  ) {
    throw invalidEnvelope();
  }
  const view = new DataView(sealed.buffer, sealed.byteOffset, sealed.byteLength);
  const keyIdLength = view.getUint16(1);
  const encryptedDataKeyLength = view.getUint32(3);
  if (
    keyIdLength === 0 ||
    keyIdLength > MAX_KMS_KEY_ID_BYTES ||
    encryptedDataKeyLength === 0 ||
    encryptedDataKeyLength > MAX_KMS_CIPHERTEXT_BLOB_BYTES
  ) {
    throw invalidEnvelope();
  }
  const keyIdOffset = KMS_ENVELOPE_HEADER_BYTES;
  const encryptedDataKeyOffset = keyIdOffset + keyIdLength;
  const ivOffset = encryptedDataKeyOffset + encryptedDataKeyLength;
  const ciphertextOffset = ivOffset + GCM_IV_BYTES;
  const ciphertextLength = sealed.byteLength - ciphertextOffset;
  if (ciphertextLength < GCM_TAG_BYTES || ciphertextLength > MAX_LOCAL_CIPHERTEXT_BYTES) {
    throw invalidEnvelope();
  }
  let wrappingKeyId: string;
  try {
    wrappingKeyId = new TextDecoder("utf-8", { fatal: true }).decode(
      sealed.slice(keyIdOffset, encryptedDataKeyOffset),
    );
    assertKmsKeyId(wrappingKeyId);
  } catch {
    throw invalidEnvelope();
  }
  return {
    wrappingKeyId,
    encryptedDataKey: sealed.slice(encryptedDataKeyOffset, ivOffset),
    iv: sealed.slice(ivOffset, ciphertextOffset),
    ciphertext: sealed.slice(ciphertextOffset),
  };
}

async function credentialKmsEncryptionContext(
  associatedData: string,
): Promise<Record<string, string>> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(associatedData));
  return {
    "rhizome-app": "rhizome",
    "rhizome-purpose": "source-credential",
    "rhizome-envelope": "v3",
    "rhizome-binding-sha256": Buffer.from(digest).toString("hex"),
  };
}

async function fingerprintMessage(token: string): Promise<Uint8Array> {
  const material = new TextEncoder().encode(`${FINGERPRINT_DOMAIN}\0${token}`);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", material));
}

async function importAesKey(keyBytes: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  if (keyBytes.byteLength !== AES_KEY_BYTES) throw invalidKmsResponse();
  const importedBytes = Uint8Array.from(keyBytes);
  try {
    return await crypto.subtle.importKey("raw", importedBytes, "AES-GCM", false, usages);
  } finally {
    importedBytes.fill(0);
  }
}

async function sendWithDeadline<T>(
  operation: (abortSignal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

function assertKmsKeyId(keyId: string): void {
  if (
    keyId.length === 0 ||
    keyId !== keyId.trim() ||
    Buffer.byteLength(keyId) > MAX_KMS_KEY_ID_BYTES ||
    /[\u0000-\u001f\u007f]/.test(keyId)
  ) {
    throw new Error("Credential KMS key ids must be non-empty, printable identifiers");
  }
}

function isKmsAlias(keyId: string): boolean {
  return keyId.startsWith("alias/") || keyId.includes(":alias/");
}

function invalidEnvelope(): Error {
  return new Error("Credential secret envelope is invalid");
}

function invalidKmsResponse(): Error {
  return new Error("Credential key service returned an invalid response");
}
