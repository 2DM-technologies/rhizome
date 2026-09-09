export const RNET_SCHEMA_VERSION = "0.1";

export function supportedRnetSchemaVersion(version: string): typeof RNET_SCHEMA_VERSION {
  if (version !== RNET_SCHEMA_VERSION) {
    throw new Error(`Unsupported stored rNet schema version: ${version}`);
  }
  return version;
}

/**
 * The store's own identity wherever a record names who acted: `created_by` on ingested records,
 * `actor` on revisions the store writes, `invoked_by` on store-initiated operations, and the
 * payer on every meter row. Bare, not `rhizome:{something}`, so it can never be mistaken for an
 * inferred key (`{writer}:{task}`).
 */
export const STORE_ACTOR = "rhizome";
