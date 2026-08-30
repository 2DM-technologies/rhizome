import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { DEFAULT_SIMPLEFIN_ALLOWED_HOSTS, loadSourceCredentialConfig } from "../src/config.ts";

const key = Uint8Array.from({ length: 32 }, (_, index) => index);
const encodedKey = Buffer.from(key).toString("base64");

describe("source credential configuration", () => {
  test("requires the AWS KMS encryption and HMAC keys in production", () => {
    expect(() => loadSourceCredentialConfig({ NODE_ENV: "production" })).toThrow(
      "RHIZOME_CREDENTIAL_KMS_KEY_ID",
    );
    const config = loadSourceCredentialConfig({
      AWS_REGION: "us-east-1",
      NODE_ENV: "production",
      RHIZOME_CREDENTIAL_KMS_HMAC_KEY_IDS:
        "arn:aws:kms:us-east-1:111122223333:key/aaaaaaaa-1234-1234-1234-123456789012",
      RHIZOME_CREDENTIAL_KMS_KEY_ID: "alias/rhizome-credential-encryption",
    });
    expect(config.keyProvider).toEqual({
      driver: "aws-kms",
      encryptionKeyId: "alias/rhizome-credential-encryption",
      fingerprintKeyIds: [
        "arn:aws:kms:us-east-1:111122223333:key/aaaaaaaa-1234-1234-1234-123456789012",
      ],
      region: "us-east-1",
      requestTimeoutMs: 5_000,
    });

    expect(() =>
      loadSourceCredentialConfig({
        NODE_ENV: "production",
        RHIZOME_CREDENTIAL_ENCRYPTION_KEY: encodedKey,
      }),
    ).toThrow("required in production");
  });

  test("rejects mutable aliases for replay-fingerprint HMAC keys", () => {
    for (const fingerprintKeyId of [
      "alias/rhizome-token-hmac-current",
      "arn:aws:kms:us-east-1:111122223333:alias/rhizome-token-hmac-current",
    ]) {
      expect(() =>
        loadSourceCredentialConfig({
          AWS_REGION: "us-east-1",
          NODE_ENV: "production",
          RHIZOME_CREDENTIAL_KMS_HMAC_KEY_IDS: fingerprintKeyId,
          RHIZOME_CREDENTIAL_KMS_KEY_ID: "alias/rhizome-credential-encryption",
        }),
      ).toThrow("immutable KMS key ids or key ARNs");
    }
  });

  test("loads KMS HMAC rotation ids and an optional legacy read keyring", () => {
    const previous = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const config = loadSourceCredentialConfig({
      AWS_REGION: "us-west-2",
      NODE_ENV: "production",
      RHIZOME_CREDENTIAL_KMS_HMAC_KEY_IDS: "arn:hmac:current,arn:hmac:previous",
      RHIZOME_CREDENTIAL_KMS_KEY_ID: "arn:encryption:current",
      RHIZOME_CREDENTIAL_KMS_TIMEOUT_MS: "2500",
      RHIZOME_CREDENTIAL_LEGACY_KEYRING: JSON.stringify({
        active: "current",
        keys: {
          current: encodedKey,
          previous: Buffer.from(previous).toString("base64"),
        },
      }),
    });
    expect(config.keyProvider.driver).toBe("aws-kms");
    if (config.keyProvider.driver !== "aws-kms") throw new Error("Expected KMS config");
    expect(config.keyProvider.fingerprintKeyIds).toEqual(["arn:hmac:current", "arn:hmac:previous"]);
    expect(config.keyProvider.legacyKeyring?.keys.get("previous")).toEqual(previous);
    expect(config.keyProvider.requestTimeoutMs).toBe(2_500);
  });

  test("keeps explicit local keyrings for development and tests", () => {
    const previous = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const config = loadSourceCredentialConfig({
      RHIZOME_CREDENTIAL_KEYRING: JSON.stringify({
        active: "current",
        keys: {
          current: encodedKey,
          previous: Buffer.from(previous).toString("base64"),
        },
      }),
    });
    expect(config.keyProvider.driver).toBe("local");
    if (config.keyProvider.driver !== "local") throw new Error("Expected local config");
    expect(config.keyProvider.keyring.activeKeyId).toBe("current");
    expect(config.keyProvider.keyring.keys.get("previous")).toEqual(previous);

    expect(() =>
      loadSourceCredentialConfig({
        RHIZOME_CREDENTIAL_ENCRYPTION_KEY: encodedKey,
        RHIZOME_CREDENTIAL_KEYRING: "{}",
      }),
    ).toThrow("not both");
  });

  test("atomically persists a private stable development key", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rhizome-credential-key-"));
    const path = join(directory, ".rhizome", "source-credential.key");
    try {
      const first = loadSourceCredentialConfig({}, { devKeyPath: path });
      const second = loadSourceCredentialConfig({}, { devKeyPath: path });

      expect(first.keyProvider.driver).toBe("local");
      expect(second.keyProvider.driver).toBe("local");
      if (first.keyProvider.driver !== "local" || second.keyProvider.driver !== "local") {
        throw new Error("Expected local config");
      }
      const firstKey = first.keyProvider.keyring.keys.get("development");
      expect(firstKey).toHaveLength(32);
      expect(second.keyProvider.keyring.keys.get("development")).toEqual(firstKey);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect((await stat(join(directory, ".rhizome"))).mode & 0o777).toBe(0o700);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("accepts only exact SimpleFIN hostnames and uses safe official defaults", () => {
    const defaults = loadSourceCredentialConfig({
      RHIZOME_CREDENTIAL_ENCRYPTION_KEY: encodedKey,
    });
    expect(defaults.simpleFinAllowedHosts).toEqual([...DEFAULT_SIMPLEFIN_ALLOWED_HOSTS]);

    const configured = loadSourceCredentialConfig({
      RHIZOME_CREDENTIAL_ENCRYPTION_KEY: encodedKey,
      RHIZOME_SIMPLEFIN_ALLOWED_HOSTS:
        "BRIDGE.SIMPLEFIN.TEST, bridge.simplefin.test, beta.simplefin.test",
    });
    expect(configured.simpleFinAllowedHosts).toEqual([
      "bridge.simplefin.test",
      "beta.simplefin.test",
    ]);

    for (const host of [
      "https://bridge.simplefin.org",
      "*.simplefin.org",
      "bridge.simplefin.org:443",
      "127.0.0.1",
      "localhost",
    ]) {
      expect(() =>
        loadSourceCredentialConfig({
          RHIZOME_CREDENTIAL_ENCRYPTION_KEY: encodedKey,
          RHIZOME_SIMPLEFIN_ALLOWED_HOSTS: host,
        }),
      ).toThrow("exact hostnames only");
    }
  });
});
