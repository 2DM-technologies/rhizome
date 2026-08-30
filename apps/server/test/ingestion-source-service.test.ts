import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";

import { CredentialedSourceCatalog } from "../../ingest/connected-sources/types.ts";
import {
  PublicRemoteSourceCatalog,
  type PublicRemoteSourceSkill,
} from "../../ingest/public-sources/types.ts";
import { SIMPLEFIN_CONNECTOR_VERSION } from "../../ingest/skills/simplefin/contracts.ts";
import { createSimpleFinSkill } from "../../ingest/skills/simplefin/source.ts";
import { installedFileSourceSkills } from "../../ingest/src/source-skill-catalog.ts";
import type { Database } from "../src/db/index.ts";
import { ingestionSources, type DbIngestionSource } from "../src/db/models/ingestion-source.ts";
import type { DbOriginArtifact } from "../src/db/models/origin-artifact.ts";
import { sourceCredentials, type DbSourceCredential } from "../src/db/models/source-credential.ts";
import { Problem } from "../src/errors.ts";
import {
  IngestionSourcesService,
  serializeIngestionSource,
} from "../src/services/ingestion-source-service.ts";

const ownerUuid = "0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47";
const originUuid = "0198f2a1-a001-7a01-8001-000000000001";
const sourceUuid = "0198f2a1-a002-7a02-8002-000000000002";
const credentialUuid = "0198f2a1-a003-7a03-8003-000000000003";
const noCredentialedSources = new CredentialedSourceCatalog([]);
const noPublicRemoteSources = new PublicRemoteSourceCatalog({ current: [] });
const syntheticPublicSources = new PublicRemoteSourceCatalog({
  current: [syntheticPublicSkill()],
});
const simpleFinSources = new CredentialedSourceCatalog([
  createSimpleFinSkill({ allowedHosts: ["bridge.simplefin.test"] }),
]);

describe("ingestion sources", () => {
  test("binds credential sources to credential owner and implementation identity", () => {
    const credentialConstraints = getTableConfig(sourceCredentials).uniqueConstraints.map(
      (constraint) => ({
        name: constraint.name,
        columns: constraint.columns.map((column) => column.name),
      }),
    );
    expect(credentialConstraints).toContainEqual({
      name: "source_credentials_uuid_user_uuid_unique",
      columns: ["uuid", "user_uuid"],
    });
    expect(credentialConstraints).toContainEqual({
      name: "source_credentials_uuid_user_uuid_skill_connector_unique",
      columns: ["uuid", "user_uuid", "skill_id", "connector_version"],
    });

    const credentialSourceReference = getTableConfig(ingestionSources)
      .foreignKeys.find(
        (constraint) =>
          constraint.getName() === "ingestion_sources_credential_owner_skill_connector_fk",
      )
      ?.reference();
    expect(credentialSourceReference?.columns.map((column) => column.name)).toEqual([
      "credential_uuid",
      "owner_uuid",
      "skill_id",
      "connector_version",
    ]);
    expect(credentialSourceReference?.foreignColumns.map((column) => column.name)).toEqual([
      "uuid",
      "user_uuid",
      "skill_id",
      "connector_version",
    ]);
  });

  test("serializes the pinned origin, connector, parser, and parser version", () => {
    expect(serializeIngestionSource(source())).toEqual({
      source: `source:${sourceUuid}`,
      kind: "origin",
      skill_id: "csv",
      connector_version: "origin-upload@1.0.0",
      parser: "csv",
      parser_version: "csv@1.1.0",
      origin: `rnet://origin/${originUuid}`,
      created_at: "2026-08-29T12:00:00.000Z",
    });
  });

  test("serializes a credential source with its pinned connector and parser versions", () => {
    expect(
      serializeIngestionSource(
        source({
          kind: "credential",
          skillId: "simplefin",
          connectorVersion: "simplefin-connector@1.0.0",
          parser: "simplefin",
          parserVersion: "simplefin@1.0.0",
          originUuid: null,
          credentialUuid,
          config: { include_pending: false },
        }),
      ),
    ).toEqual({
      source: `source:${sourceUuid}`,
      kind: "credential",
      skill_id: "simplefin",
      connector_version: "simplefin-connector@1.0.0",
      parser: "simplefin",
      parser_version: "simplefin@1.0.0",
      config: { include_pending: false },
      created_at: "2026-08-29T12:00:00.000Z",
    });
  });

  test("serializes a public remote without exposing provider-specific protocol fields", () => {
    expect(
      serializeIngestionSource(
        source({
          kind: "remote",
          skillId: "synthetic_public",
          connectorVersion: "synthetic-public-connector@1",
          parser: "synthetic-public",
          parserVersion: "synthetic-public@1",
          originUuid: null,
          config: { locator: "https://public.example.test/feed" },
        }),
      ),
    ).toEqual({
      source: `source:${sourceUuid}`,
      kind: "remote",
      skill_id: "synthetic_public",
      connector_version: "synthetic-public-connector@1",
      parser: "synthetic-public",
      parser_version: "synthetic-public@1",
      config: { locator: "https://public.example.test/feed" },
      created_at: "2026-08-29T12:00:00.000Z",
    });
  });

  test("normalizes public-source input and pins its registered implementation", async () => {
    let inserted: Record<string, unknown> | undefined;
    const service = ownedService(
      databaseWithOrigin(origin(), (candidate) => {
        inserted = candidate;
      }),
      noCredentialedSources,
      syntheticPublicSources,
    );

    await service.create({
      skill_id: "synthetic_public",
      config: { url: "https://public.example.test/feed" },
    });
    expect(inserted).toMatchObject({
      ownerUuid,
      kind: "remote",
      skillId: "synthetic_public",
      connectorVersion: "synthetic-public-connector@1",
      parser: "synthetic-public",
      parserVersion: "synthetic-public@1",
      config: { locator: "https://public.example.test/feed" },
    });
  });

  test("copies a matching credential connector pin and rejects unavailable pins", async () => {
    let inserted: Record<string, unknown> | undefined;
    const matching = credential();
    const service = ownedService(
      databaseWithCredential(matching, (candidate) => {
        inserted = candidate;
      }),
      simpleFinSources,
    );

    await service.create({ credential: `credential:${credentialUuid}` });
    expect(inserted).toMatchObject({
      skillId: "simplefin",
      connectorVersion: SIMPLEFIN_CONNECTOR_VERSION,
      credentialUuid,
    });

    let mismatchInserted = false;
    const mismatched = ownedService(
      databaseWithCredential(credential({ connectorVersion: "simplefin-connector@0.9.0" }), () => {
        mismatchInserted = true;
      }),
      simpleFinSources,
    );
    const problem = await capturedProblem(
      mismatched.create({ credential: `credential:${credentialUuid}` }),
    );
    expect(problem).toMatchObject({
      status: 422,
      code: "parser_unsupported",
      title: "Pinned connector unavailable",
      detail: "simplefin-connector@0.9.0",
    });
    expect(mismatchInserted).toBe(false);
  });

  test("refuses internally inconsistent rows instead of emitting an invalid document", () => {
    expect(() =>
      serializeIngestionSource({
        ...source(),
        originUuid: undefined,
      } as unknown as DbIngestionSource),
    ).toThrow("internally inconsistent");
    expect(() => serializeIngestionSource(source({ parser: "" }))).toThrow(
      "internally inconsistent",
    );
    expect(() => serializeIngestionSource(source({ skillId: "" }))).toThrow(
      "internally inconsistent",
    );
    expect(() => serializeIngestionSource(source({ connectorVersion: "" }))).toThrow(
      "internally inconsistent",
    );
  });

  test("requires a user owner before touching persistence", async () => {
    let databaseTouched = false;
    const db = new Proxy({} as Database, {
      get() {
        databaseTouched = true;
        throw new Error("Database must not be touched");
      },
    });
    const service = new IngestionSourcesService({
      db,
      actor: {
        kind: "client",
        uuid: "0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b48",
        name: "rbudget",
        subject: "client:rbudget",
      },
      credentialedSources: noCredentialedSources,
      fileSources: installedFileSourceSkills,
      publicRemoteSources: noPublicRemoteSources,
    });

    const problem = await capturedProblem(
      service.create({
        origin: `rnet://origin/${originUuid}`,
        skill_id: "csv",
      }),
    );
    expect(problem).toMatchObject({ status: 403, code: "grant_missing" });
    expect(databaseTouched).toBe(false);
  });

  test("rejects unknown and non-file skills before touching persistence", async () => {
    let databaseTouched = false;
    const db = new Proxy({} as Database, {
      get() {
        databaseTouched = true;
        throw new Error("Database must not be touched");
      },
    });
    const service = ownedService(db);

    const unsupported = await capturedProblem(
      service.create({
        origin: `rnet://origin/${originUuid}`,
        skill_id: "unknown",
      }),
    );
    expect(unsupported).toMatchObject({ status: 422, code: "parser_unsupported" });

    const connected = await capturedProblem(
      service.create({
        origin: `rnet://origin/${originUuid}`,
        skill_id: "simplefin",
      }),
    );
    expect(connected).toMatchObject({ status: 422, code: "parser_unsupported" });
    expect(databaseTouched).toBe(false);
  });

  test("does not reveal an origin that is missing, tombstoned, or owned by someone else", async () => {
    let inserted = false;
    const db = databaseWithOrigin(undefined, () => {
      inserted = true;
    });
    const service = ownedService(db);

    const problem = await capturedProblem(
      service.create({
        origin: `rnet://origin/${originUuid}`,
        skill_id: "csv",
      }),
    );
    expect(problem).toMatchObject({
      status: 404,
      code: "not_found",
      detail: "Origin does not exist",
    });
    expect(inserted).toBe(false);
  });

  test("pins the registered parser version and actor ownership during creation", async () => {
    let inserted: Record<string, unknown> | undefined;
    const db = databaseWithOrigin(origin(), (candidate) => {
      inserted = candidate;
    });
    const service = ownedService(db);

    const created = await service.create({
      origin: `rnet://origin/${originUuid}`,
      skill_id: "ofx",
    });

    expect(inserted).toMatchObject({
      ownerUuid,
      kind: "origin",
      skillId: "ofx",
      connectorVersion: "origin-upload@1.0.0",
      parser: "ofx",
      parserVersion: "ofx@1.1.0",
      originUuid,
    });
    expect(inserted?.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(created).toMatchObject(inserted!);
  });
});

function ownedService(
  db: Database,
  credentialedSources: CredentialedSourceCatalog = noCredentialedSources,
  publicRemoteSources: PublicRemoteSourceCatalog = noPublicRemoteSources,
): IngestionSourcesService {
  return new IngestionSourcesService({
    db,
    actor: { kind: "user", uuid: ownerUuid, subject: `id:rnet://id/${ownerUuid}` },
    credentialedSources,
    fileSources: installedFileSourceSkills,
    publicRemoteSources,
  });
}

function syntheticPublicSkill(): PublicRemoteSourceSkill {
  const parser = {
    name: "synthetic-public",
    version: "synthetic-public@1",
    async parse() {
      return {};
    },
  };
  return {
    skillId: "synthetic_public",
    displayName: "Synthetic public source",
    manifest: {
      skill_id: "synthetic_public",
      label: "Synthetic public source",
      description: "A generic public source used by server boundary tests.",
      source_kind: "public_remote",
      connector_version: "synthetic-public-connector@1",
      parser: { name: parser.name, version: parser.version },
      input_fields: [
        {
          name: "url",
          label: "URL",
          target: "source",
          control: "url",
          required: true,
          secret: false,
        },
      ],
      review_actions: ["review_import"],
    },
    parser,
    fetchPolicy: { attempts: 10, windowHours: 24 },
    networkPolicy: {
      capabilities: [{ kind: "safe_public_https" }],
    },
    capture: { mime: "application/json", label: (_config, id) => `capture-${id}.json` },
    normalizeConfig(input) {
      const url = (input as { url?: unknown }).url;
      if (typeof url !== "string" || !url.startsWith("https://")) {
        throw new Error("A public HTTPS URL is required");
      }
      return { locator: url };
    },
    parseConfig(value) {
      const locator = (value as { locator?: unknown }).locator;
      if (typeof locator !== "string") throw new Error("Stored locator is invalid");
      return { locator };
    },
    stateDigest: (config) => ({ locator: (config as { locator: string }).locator }),
    async retrieve() {
      return new Uint8Array();
    },
    verify: () => ({ ok: true, checks: [] }),
    candidates: () => [],
  };
}

function databaseWithCredential(
  foundCredential: DbSourceCredential,
  onInsert: (candidate: Record<string, unknown>) => void,
): Database {
  const transaction = {
    select: () => ({
      from: () => ({
        where: () => ({ for: async () => [foundCredential] }),
      }),
    }),
    insert: () => ({
      values: (candidate: Record<string, unknown>) => ({
        returning: async () => {
          onInsert(candidate);
          return [
            source({
              ...(candidate as Partial<DbIngestionSource>),
              originUuid: null,
              createdAt: new Date("2026-08-29T12:00:00.000Z"),
              revokedAt: null,
            }),
          ];
        },
      }),
    }),
  };
  return {
    transaction: async (callback: (database: typeof transaction) => unknown) =>
      callback(transaction),
  } as unknown as Database;
}

function databaseWithOrigin(
  foundOrigin: DbOriginArtifact | undefined,
  onInsert: (candidate: Record<string, unknown>) => void,
): Database {
  return {
    query: {
      originArtifacts: {
        findFirst: async () => foundOrigin,
      },
    },
    insert: () => ({
      values: (candidate: Record<string, unknown>) => ({
        returning: async () => {
          onInsert(candidate);
          return [
            source({
              ...(candidate as Partial<DbIngestionSource>),
              createdAt: new Date("2026-08-29T12:00:00.000Z"),
              revokedAt: null,
            }),
          ];
        },
      }),
    }),
  } as unknown as Database;
}

function origin(overrides: Partial<DbOriginArtifact> = {}): DbOriginArtifact {
  return {
    uuid: originUuid,
    ownerUuid,
    contentHash: `sha256:${"a".repeat(64)}`,
    mime: "text/csv",
    byteSize: 128,
    label: "transactions.csv",
    rnetSchema: "0.1",
    uploadedAt: new Date("2026-08-29T11:00:00.000Z"),
    tombstonedAt: null,
    ...overrides,
  };
}

function source(overrides: Partial<DbIngestionSource> = {}): DbIngestionSource {
  return {
    uuid: sourceUuid,
    ownerUuid,
    kind: "origin",
    skillId: "csv",
    connectorVersion: "origin-upload@1.0.0",
    parser: "csv",
    parserVersion: "csv@1.1.0",
    originUuid,
    credentialUuid: null,
    config: null,
    createdAt: new Date("2026-08-29T12:00:00.000Z"),
    revokedAt: null,
    ...overrides,
  };
}

function credential(overrides: Partial<DbSourceCredential> = {}): DbSourceCredential {
  return {
    uuid: credentialUuid,
    userUuid: ownerUuid,
    skillId: "simplefin",
    connectorVersion: SIMPLEFIN_CONNECTOR_VERSION,
    secret: Uint8Array.of(1),
    metadata: null,
    connectedAt: new Date("2026-08-29T11:00:00.000Z"),
    revokedAt: null,
    ...overrides,
  };
}

async function capturedProblem(promise: Promise<unknown>): Promise<Problem> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(Problem);
    return error as Problem;
  }
  throw new Error("Expected a Problem");
}
