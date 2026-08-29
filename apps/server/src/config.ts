import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isIP } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createCredentialKeyring,
  decodeCredentialEncryptionKey,
  type CredentialKeyring,
} from "./services/source-credential-crypto.ts";

export type SourceCredentialKeyProviderConfig =
  | {
      driver: "local";
      keyring: CredentialKeyring;
    }
  | {
      driver: "aws-kms";
      encryptionKeyId: string;
      fingerprintKeyIds: readonly [string, ...string[]];
      legacyKeyring?: CredentialKeyring;
      region: string;
      requestTimeoutMs: number;
    };

export interface SourceCredentialConfig {
  keyProvider: SourceCredentialKeyProviderConfig;
  simpleFinAllowedHosts: string[];
}

export interface ServerConfig {
  port: number;
  databaseUrl: string;
  authMode: "dev";
  baseUrl: string;
  allowedOrigins: string[];
  maxRequestBodySize: number;
  sourceCredentials: SourceCredentialConfig;
  blob: {
    driver: "r2";
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
    buckets: Record<BlobNamespace, string>;
  };
}

/** The four buckets, enumerable so tooling can create them rather than restating the list. */
export const BLOB_NAMESPACES = ["elements", "origins", "bundles", "assets"] as const;
export type BlobNamespace = (typeof BLOB_NAMESPACES)[number];

export const DEFAULT_SIMPLEFIN_ALLOWED_HOSTS = [
  "bridge.simplefin.org",
  "beta-bridge.simplefin.org",
] as const;

const EXACT_HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadConfig(): ServerConfig {
  const authMode = process.env.RHIZOME_AUTH_MODE ?? "dev";
  if (authMode !== "dev") throw new Error(`Unsupported RHIZOME_AUTH_MODE: ${authMode}`);
  if (process.env.NODE_ENV === "production" && authMode === "dev") {
    throw new Error("Development authentication is forbidden in production");
  }
  const baseUrl = (process.env.RHIZOME_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const maxRequestBodySize = Number(process.env.RHIZOME_MAX_REQUEST_BODY_BYTES ?? 52_428_800);
  if (!Number.isSafeInteger(maxRequestBodySize) || maxRequestBodySize <= 0) {
    throw new Error("RHIZOME_MAX_REQUEST_BODY_BYTES must be a positive integer");
  }
  const allowedOrigins = (process.env.RHIZOME_ALLOWED_ORIGINS ?? new URL(baseUrl).origin)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: process.env.DATABASE_URL ?? "postgres://localhost/rhizome",
    authMode,
    baseUrl,
    allowedOrigins,
    maxRequestBodySize,
    sourceCredentials: loadSourceCredentialConfig(),
    blob: {
      driver: "r2",
      endpoint: required("R2_ENDPOINT"),
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
      forcePathStyle: process.env.R2_FORCE_PATH_STYLE === "true",
      buckets: {
        elements: process.env.R2_ELEMENTS_BUCKET ?? "elements",
        origins: process.env.R2_ORIGINS_BUCKET ?? "origins",
        bundles: process.env.R2_BUNDLES_BUCKET ?? "bundles",
        assets: process.env.R2_ASSETS_BUCKET ?? "assets",
      },
    },
  };
}

export function loadSourceCredentialConfig(
  environment: Record<string, string | undefined> = process.env,
  options: { devKeyPath?: string } = {},
): SourceCredentialConfig {
  const keyProvider = loadCredentialKeyProvider(environment, options);

  const configuredHosts =
    environment.RHIZOME_SIMPLEFIN_ALLOWED_HOSTS ?? DEFAULT_SIMPLEFIN_ALLOWED_HOSTS.join(",");
  const simpleFinAllowedHosts = [
    ...new Set(
      configuredHosts
        .split(",")
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (simpleFinAllowedHosts.length === 0) {
    throw new Error("RHIZOME_SIMPLEFIN_ALLOWED_HOSTS must contain at least one exact hostname");
  }
  for (const host of simpleFinAllowedHosts) {
    if (!EXACT_HOSTNAME_PATTERN.test(host) || isIP(host) !== 0) {
      throw new Error(
        "RHIZOME_SIMPLEFIN_ALLOWED_HOSTS accepts exact hostnames only; URLs, ports, IP addresses, and wildcards are forbidden",
      );
    }
  }

  return {
    keyProvider,
    simpleFinAllowedHosts,
  };
}

function loadCredentialKeyProvider(
  environment: Record<string, string | undefined>,
  options: { devKeyPath?: string },
): SourceCredentialKeyProviderConfig {
  const kmsEncryptionKeyId = environment.RHIZOME_CREDENTIAL_KMS_KEY_ID?.trim();
  const encodedFingerprintKeyIds = environment.RHIZOME_CREDENTIAL_KMS_HMAC_KEY_IDS?.trim();
  const legacyKeyring = environment.RHIZOME_CREDENTIAL_LEGACY_KEYRING;
  const encodedKeyring = environment.RHIZOME_CREDENTIAL_KEYRING;
  const legacyEncodedKey = environment.RHIZOME_CREDENTIAL_ENCRYPTION_KEY;
  const kmsConfigured = Boolean(kmsEncryptionKeyId || encodedFingerprintKeyIds);

  if (kmsConfigured) {
    if (!kmsEncryptionKeyId || !encodedFingerprintKeyIds) {
      throw new Error(
        "RHIZOME_CREDENTIAL_KMS_KEY_ID and RHIZOME_CREDENTIAL_KMS_HMAC_KEY_IDS must be configured together",
      );
    }
    if (encodedKeyring || legacyEncodedKey) {
      throw new Error(
        "Production KMS keys cannot be combined with an active local credential keyring",
      );
    }
    const region = (environment.AWS_REGION ?? environment.AWS_DEFAULT_REGION)?.trim();
    if (!region) {
      throw new Error("AWS_REGION is required for the credential KMS provider");
    }
    const fingerprintKeyIds = encodedFingerprintKeyIds.split(",").map((keyId) => keyId.trim());
    if (fingerprintKeyIds.some((keyId) => !keyId)) {
      throw new Error(
        "RHIZOME_CREDENTIAL_KMS_HMAC_KEY_IDS must contain non-empty KMS key identifiers",
      );
    }
    if (fingerprintKeyIds.some(isKmsAlias)) {
      throw new Error(
        "RHIZOME_CREDENTIAL_KMS_HMAC_KEY_IDS must use immutable KMS key ids or key ARNs, not aliases",
      );
    }
    if (new Set(fingerprintKeyIds).size !== fingerprintKeyIds.length) {
      throw new Error("RHIZOME_CREDENTIAL_KMS_HMAC_KEY_IDS must not contain duplicates");
    }
    const requestTimeoutMs = Number(environment.RHIZOME_CREDENTIAL_KMS_TIMEOUT_MS ?? 5_000);
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
      throw new Error("RHIZOME_CREDENTIAL_KMS_TIMEOUT_MS must be a positive integer");
    }
    return {
      driver: "aws-kms",
      encryptionKeyId: kmsEncryptionKeyId,
      fingerprintKeyIds: fingerprintKeyIds as [string, ...string[]],
      ...(legacyKeyring
        ? {
            legacyKeyring: decodeCredentialKeyring(
              legacyKeyring,
              "RHIZOME_CREDENTIAL_LEGACY_KEYRING",
            ),
          }
        : {}),
      region,
      requestTimeoutMs,
    };
  }
  if (legacyKeyring) {
    throw new Error("RHIZOME_CREDENTIAL_LEGACY_KEYRING requires the credential KMS provider");
  }
  if (environment.NODE_ENV === "production") {
    throw new Error(
      "RHIZOME_CREDENTIAL_KMS_KEY_ID and RHIZOME_CREDENTIAL_KMS_HMAC_KEY_IDS are required in production",
    );
  }

  return {
    driver: "local",
    keyring: loadLocalCredentialKeyring(environment, options),
  };
}

function isKmsAlias(keyId: string): boolean {
  return keyId.startsWith("alias/") || keyId.includes(":alias/");
}

function loadLocalCredentialKeyring(
  environment: Record<string, string | undefined>,
  options: { devKeyPath?: string },
): CredentialKeyring {
  const encodedKeyring = environment.RHIZOME_CREDENTIAL_KEYRING;
  const legacyEncodedKey = environment.RHIZOME_CREDENTIAL_ENCRYPTION_KEY;
  if (encodedKeyring && legacyEncodedKey) {
    throw new Error(
      "Configure either RHIZOME_CREDENTIAL_KEYRING or RHIZOME_CREDENTIAL_ENCRYPTION_KEY, not both",
    );
  }
  if (encodedKeyring) return decodeCredentialKeyring(encodedKeyring);
  if (legacyEncodedKey) {
    return createCredentialKeyring("legacy", {
      legacy: decodeCredentialEncryptionKey(legacyEncodedKey),
    });
  }
  const encodedDevelopmentKey = loadOrCreateDevelopmentCredentialKey(
    options.devKeyPath ??
      fileURLToPath(new URL("../../../.rhizome/source-credential.key", import.meta.url)),
  );
  return createCredentialKeyring("development", {
    development: decodeCredentialEncryptionKey(encodedDevelopmentKey),
  });
}

function decodeCredentialKeyring(
  value: string,
  environmentName = "RHIZOME_CREDENTIAL_KEYRING",
): CredentialKeyring {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${environmentName} must be valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${environmentName} must be a JSON object`);
  }
  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => key !== "active" && key !== "keys") ||
    typeof record.active !== "string" ||
    !record.keys ||
    typeof record.keys !== "object" ||
    Array.isArray(record.keys)
  ) {
    throw new Error(
      `${environmentName} must have shape {"active":"key-id","keys":{"key-id":"base64"}}`,
    );
  }
  const keys: Record<string, Uint8Array> = {};
  for (const [keyId, encodedKey] of Object.entries(record.keys as Record<string, unknown>)) {
    if (typeof encodedKey !== "string") {
      throw new Error(`${environmentName} key values must be base64 strings`);
    }
    keys[keyId] = decodeCredentialEncryptionKey(encodedKey);
  }
  return createCredentialKeyring(record.active, keys);
}

function loadOrCreateDevelopmentCredentialKey(path: string): string {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);

  try {
    return readDevelopmentCredentialKey(path);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }

  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const encodedKey = randomBytes(32).toString("base64");
  let temporaryCreated = false;
  try {
    const descriptor = openSync(
      temporaryPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o600,
    );
    temporaryCreated = true;
    try {
      writeFileSync(descriptor, `${encodedKey}\n`, "utf8");
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }

    try {
      // Creating the final hard link is atomic and cannot replace a key another
      // development process won the race to create.
      linkSync(temporaryPath, path);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      return readDevelopmentCredentialKey(path);
    }
    chmodSync(path, 0o600);
    return encodedKey;
  } finally {
    if (temporaryCreated) {
      try {
        unlinkSync(temporaryPath);
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
    }
  }
}

function readDevelopmentCredentialKey(path: string): string {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Development credential key must be a regular file: ${path}`);
  }
  chmodSync(path, 0o600);
  const encodedKey = readFileSync(path, "utf8").trim();
  decodeCredentialEncryptionKey(encodedKey);
  return encodedKey;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
