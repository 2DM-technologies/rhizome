export const RNET_SCHEMA_VERSION = "0.1";

export function supportedRnetSchemaVersion(version: string): typeof RNET_SCHEMA_VERSION {
  if (version !== RNET_SCHEMA_VERSION) {
    throw new Error(`Unsupported stored rNet schema version: ${version}`);
  }
  return version;
}
