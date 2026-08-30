const AES_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
const LEGACY_SEALED_SECRET_VERSION = 1;
const SEALED_SECRET_VERSION = 2;
const MAX_KEY_ID_BYTES = 64;
const CLAIM_FINGERPRINT_HKDF_INFO = "rhizome:source-credential-claim-fingerprint:v1";
const LEGACY_SIMPLEFIN_FINGERPRINT_HKDF_INFO = "rhizome:simplefin-setup-token-fingerprint:v1";
const LEGACY_SIMPLEFIN_SKILL_ID = "simplefin";

export interface CredentialKeyring {
  activeKeyId: string;
  keys: ReadonlyMap<string, Uint8Array>;
}

export type CredentialEncryptionKeys = Uint8Array | CredentialKeyring;

export interface CredentialClaimFingerprints {
  active: string;
  all: readonly string[];
}

export interface PreparedCredentialSecretSeal {
  destroy(): void;
  seal(secret: string): Promise<Uint8Array>;
}

/**
 * Runtime boundary for credential protection. Production can prepare a KMS data key before
 * consuming a one-time provider token; development and tests use the local keyring adapter.
 */
export interface SourceCredentialCrypto {
  fingerprintConnectionClaim(
    skillId: string,
    replayKey: string,
  ): Promise<CredentialClaimFingerprints>;
  open(sealed: Uint8Array, associatedData: string): Promise<string>;
  prepareSeal(associatedData: string): Promise<PreparedCredentialSecretSeal>;
}

export function createLocalSourceCredentialCrypto(
  encryptionKeys: CredentialEncryptionKeys,
): SourceCredentialCrypto {
  const keyring = normalizeKeyring(encryptionKeys);
  return {
    fingerprintConnectionClaim: (skillId, replayKey) =>
      fingerprintCredentialConnectionClaim(skillId, replayKey, keyring),
    open: (sealed, associatedData) => openCredentialSecret(sealed, keyring, associatedData),
    async prepareSeal(associatedData) {
      let available = true;
      return {
        destroy() {
          available = false;
        },
        async seal(secret) {
          if (!available) throw new Error("Prepared credential secret seal is unavailable");
          available = false;
          return sealCredentialSecret(secret, keyring, associatedData);
        },
      };
    },
  };
}

export function decodeCredentialEncryptionKey(value: string): Uint8Array {
  let key: Uint8Array;
  try {
    key = Uint8Array.from(Buffer.from(value, "base64"));
  } catch {
    throw new Error("RHIZOME_CREDENTIAL_ENCRYPTION_KEY must be base64 encoded");
  }
  if (key.byteLength !== AES_KEY_BYTES || Buffer.from(key).toString("base64") !== value) {
    throw new Error(`RHIZOME_CREDENTIAL_ENCRYPTION_KEY must encode exactly ${AES_KEY_BYTES} bytes`);
  }
  return key;
}

export function createCredentialKeyring(
  activeKeyId: string,
  keys: Readonly<Record<string, Uint8Array>> | ReadonlyMap<string, Uint8Array>,
): CredentialKeyring {
  assertKeyId(activeKeyId);
  const entries = keys instanceof Map ? [...keys.entries()] : Object.entries(keys);
  const normalized = new Map<string, Uint8Array>();
  for (const [keyId, keyBytes] of entries) {
    assertKeyId(keyId);
    if (keyBytes.byteLength !== AES_KEY_BYTES) {
      throw new Error(`Credential encryption keys must be ${AES_KEY_BYTES} bytes`);
    }
    normalized.set(keyId, Uint8Array.from(keyBytes));
  }
  if (!normalized.has(activeKeyId)) {
    throw new Error(`Active credential encryption key is missing: ${activeKeyId}`);
  }
  return { activeKeyId, keys: normalized };
}

export async function sealCredentialSecret(
  secret: string,
  encryptionKeys: CredentialEncryptionKeys,
  associatedData: string,
): Promise<Uint8Array> {
  if (!secret) throw new Error("Credential secret cannot be empty");
  const keyring = normalizeKeyring(encryptionKeys);
  const keyBytes = keyring.keys.get(keyring.activeKeyId);
  if (!keyBytes) throw new Error("Active credential encryption key is unavailable");
  const key = await importKey(keyBytes, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  const encodedKeyId = new TextEncoder().encode(keyring.activeKeyId);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(associatedData),
    },
    key,
    new TextEncoder().encode(secret),
  );
  const sealed = new Uint8Array(
    2 + encodedKeyId.byteLength + iv.byteLength + ciphertext.byteLength,
  );
  sealed[0] = SEALED_SECRET_VERSION;
  sealed[1] = encodedKeyId.byteLength;
  sealed.set(encodedKeyId, 2);
  sealed.set(iv, 2 + encodedKeyId.byteLength);
  sealed.set(new Uint8Array(ciphertext), 2 + encodedKeyId.byteLength + iv.byteLength);
  return sealed;
}

export async function openCredentialSecret(
  sealed: Uint8Array,
  encryptionKeys: CredentialEncryptionKeys,
  associatedData: string,
): Promise<string> {
  const keyring = normalizeKeyring(encryptionKeys);
  if (sealed[0] === LEGACY_SEALED_SECRET_VERSION) {
    return openLegacyCredentialSecret(sealed, keyring, associatedData);
  }
  if (sealed.byteLength <= 2 + GCM_IV_BYTES || sealed[0] !== SEALED_SECRET_VERSION) {
    throw new Error("Credential secret envelope is invalid");
  }
  const keyIdLength = sealed[1] ?? 0;
  const ivOffset = 2 + keyIdLength;
  if (
    keyIdLength === 0 ||
    keyIdLength > MAX_KEY_ID_BYTES ||
    sealed.byteLength <= ivOffset + GCM_IV_BYTES
  ) {
    throw new Error("Credential secret envelope is invalid");
  }
  let keyId: string;
  try {
    keyId = new TextDecoder("utf-8", { fatal: true }).decode(sealed.slice(2, ivOffset));
    assertKeyId(keyId);
  } catch {
    throw new Error("Credential secret envelope is invalid");
  }
  const keyBytes = keyring.keys.get(keyId);
  if (!keyBytes) throw new Error(`Credential encryption key is unavailable: ${keyId}`);
  const key = await importKey(keyBytes, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: sealed.slice(ivOffset, ivOffset + GCM_IV_BYTES),
      additionalData: new TextEncoder().encode(associatedData),
    },
    key,
    sealed.slice(ivOffset + GCM_IV_BYTES),
  );
  return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
}

export async function fingerprintCredentialConnectionClaim(
  skillId: string,
  replayKey: string,
  encryptionKeys: CredentialEncryptionKeys,
): Promise<CredentialClaimFingerprints> {
  const message = credentialClaimFingerprintMessage(skillId, replayKey);
  const legacySimpleFinMessage =
    skillId === LEGACY_SIMPLEFIN_SKILL_ID ? new TextEncoder().encode(replayKey.trim()) : undefined;
  const keyring = normalizeKeyring(encryptionKeys);
  const keyIds = [
    keyring.activeKeyId,
    ...[...keyring.keys.keys()]
      .filter((keyId) => keyId !== keyring.activeKeyId)
      .sort((left, right) => left.localeCompare(right)),
  ];
  const fingerprints: string[] = [];
  for (const keyId of keyIds) {
    const keyBytes = keyring.keys.get(keyId);
    if (!keyBytes) continue;
    const hmacKey = await deriveFingerprintKey(keyBytes, CLAIM_FINGERPRINT_HKDF_INFO);
    const signature = await crypto.subtle.sign("HMAC", hmacKey, message);
    // Fingerprint identity deliberately excludes the configuration key id. Renaming a
    // retained key during rotation must not make the same one-time token claimable again.
    fingerprints.push(`hmac-sha256-hkdf-v1:${Buffer.from(signature).toString("hex")}`);
  }
  if (legacySimpleFinMessage) {
    // Claims made before credential skills were generalized used a SimpleFIN-specific HKDF
    // domain and signed the canonical token without a skill-id prefix. Retain those exact
    // aliases so an already-consumed one-time token still resolves to its existing ledger row.
    for (const keyId of keyIds) {
      const keyBytes = keyring.keys.get(keyId);
      if (!keyBytes) continue;
      const hmacKey = await deriveFingerprintKey(keyBytes, LEGACY_SIMPLEFIN_FINGERPRINT_HKDF_INFO);
      const signature = await crypto.subtle.sign("HMAC", hmacKey, legacySimpleFinMessage);
      fingerprints.push(`hmac-sha256-hkdf-v1:${Buffer.from(signature).toString("hex")}`);
    }
  }
  const uniqueFingerprints = [...new Set(fingerprints)];
  const active = uniqueFingerprints[0];
  if (!active) throw new Error("Active credential encryption key is unavailable");
  return { active, all: uniqueFingerprints };
}

export function credentialAssociatedData(
  credentialUuid: string,
  ownerUuid: string,
  skillId: string,
): string {
  return `rhizome:source-credential:v1:${credentialUuid}:${ownerUuid}:${skillId}`;
}

async function importKey(keyBytes: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  if (keyBytes.byteLength !== AES_KEY_BYTES) {
    throw new Error(`Credential encryption keys must be ${AES_KEY_BYTES} bytes`);
  }
  return crypto.subtle.importKey("raw", Uint8Array.from(keyBytes), "AES-GCM", false, usages);
}

async function deriveFingerprintKey(keyBytes: Uint8Array, info: string): Promise<CryptoKey> {
  if (keyBytes.byteLength !== AES_KEY_BYTES) {
    throw new Error(`Credential encryption keys must be ${AES_KEY_BYTES} bytes`);
  }
  const material = await crypto.subtle.importKey("raw", Uint8Array.from(keyBytes), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: new TextEncoder().encode(info),
    },
    material,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
}

function credentialClaimFingerprintMessage(skillId: string, replayKey: string): ArrayBuffer {
  if (!skillId || skillId !== skillId.trim() || skillId.includes("\0")) {
    throw new Error("Credential skill id must be a non-empty canonical identifier");
  }
  if (!replayKey || replayKey.includes("\0")) {
    throw new Error("Credential claim replay key must be non-empty");
  }
  return new TextEncoder().encode(`${skillId}\0${replayKey}`).buffer;
}

function normalizeKeyring(encryptionKeys: CredentialEncryptionKeys): CredentialKeyring {
  return encryptionKeys instanceof Uint8Array
    ? createCredentialKeyring("legacy", { legacy: encryptionKeys })
    : createCredentialKeyring(encryptionKeys.activeKeyId, encryptionKeys.keys);
}

async function openLegacyCredentialSecret(
  sealed: Uint8Array,
  keyring: CredentialKeyring,
  associatedData: string,
): Promise<string> {
  if (sealed.byteLength <= 1 + GCM_IV_BYTES) {
    throw new Error("Credential secret envelope is invalid");
  }
  for (const keyBytes of keyring.keys.values()) {
    try {
      const key = await importKey(keyBytes, ["decrypt"]);
      const plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: sealed.slice(1, 1 + GCM_IV_BYTES),
          additionalData: new TextEncoder().encode(associatedData),
        },
        key,
        sealed.slice(1 + GCM_IV_BYTES),
      );
      return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    } catch {
      // A v1 envelope did not record which key sealed it, so rotation requires
      // trying the configured legacy keys without exposing which one matched.
    }
  }
  throw new Error("Credential secret could not be decrypted with the configured keys");
}

function assertKeyId(keyId: string): void {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId) || Buffer.byteLength(keyId) > MAX_KEY_ID_BYTES) {
    throw new Error(
      "Credential encryption key ids must use 1-64 ASCII letters, numbers, '.', '_', or '-'",
    );
  }
}
