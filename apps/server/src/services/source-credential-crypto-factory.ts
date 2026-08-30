import type { SourceCredentialKeyProviderConfig } from "../config.ts";
import {
  createLocalSourceCredentialCrypto,
  type SourceCredentialCrypto,
} from "./source-credential-crypto.ts";
import {
  AwsKmsSourceCredentialCrypto,
  createAwsKmsTransport,
} from "./source-credential-kms-crypto.ts";

export function createSourceCredentialCrypto(
  config: SourceCredentialKeyProviderConfig,
): SourceCredentialCrypto {
  if (config.driver === "local") {
    return createLocalSourceCredentialCrypto(config.keyring);
  }
  return new AwsKmsSourceCredentialCrypto({
    encryptionKeyId: config.encryptionKeyId,
    fingerprintKeyIds: config.fingerprintKeyIds,
    kms: createAwsKmsTransport({
      region: config.region,
      requestTimeoutMs: config.requestTimeoutMs,
    }),
    legacyEncryptionKeys: config.legacyKeyring,
  });
}
