import { describe, expect, test } from "bun:test";

import type { Database } from "../src/db/index.ts";
import type { DbIngestionSource } from "../src/db/models/ingestion-source.ts";
import type { DbOriginArtifact } from "../src/db/models/origin-artifact.ts";
import { Problem } from "../src/errors.ts";
import {
  IngestionSourcesService,
  serializeIngestionSource,
} from "../src/services/ingestion-source-service.ts";

const ownerUuid = "0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47";
const originUuid = "0198f2a1-a001-7a01-8001-000000000001";
const sourceUuid = "0198f2a1-a002-7a02-8002-000000000002";

describe("origin ingestion sources", () => {
  test("serializes the pinned origin, parser, and parser version", () => {
    expect(serializeIngestionSource(source())).toEqual({
      source: `source:${sourceUuid}`,
      kind: "origin",
      parser: "csv",
      parser_version: "csv@1.1.0",
      origin: `rnet://origin/${originUuid}`,
      created_at: "2026-08-29T12:00:00.000Z",
    });
  });

  test("refuses internally inconsistent rows instead of emitting an invalid document", () => {
    expect(() =>
      serializeIngestionSource({
        ...source(),
        originUuid: undefined,
      } as unknown as DbIngestionSource),
    ).toThrow("internally inconsistent");
    expect(() =>
      serializeIngestionSource(source({ parser: "simplefin", parserVersion: "simplefin@1.0.0" })),
    ).toThrow("internally inconsistent");
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
    });

    const problem = await capturedProblem(
      service.create({ origin: `rnet://origin/${originUuid}`, parser: "csv" }),
    );
    expect(problem).toMatchObject({ status: 403, code: "grant_missing" });
    expect(databaseTouched).toBe(false);
  });

  test("rejects unsupported and connected-provider parsers before touching persistence", async () => {
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
        parser: "unknown",
      } as unknown as Parameters<IngestionSourcesService["create"]>[0]),
    );
    expect(unsupported).toMatchObject({ status: 422, code: "parser_unsupported" });

    const connected = await capturedProblem(
      service.create({
        origin: `rnet://origin/${originUuid}`,
        parser: "simplefin",
      } as unknown as Parameters<IngestionSourcesService["create"]>[0]),
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
      service.create({ origin: `rnet://origin/${originUuid}`, parser: "csv" }),
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
      parser: "ofx",
    });

    expect(inserted).toMatchObject({
      ownerUuid,
      kind: "origin",
      parser: "ofx",
      parserVersion: "ofx@1.1.0",
      originUuid,
    });
    expect(inserted?.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(created).toMatchObject(inserted!);
  });
});

function ownedService(db: Database): IngestionSourcesService {
  return new IngestionSourcesService({
    db,
    actor: { kind: "user", uuid: ownerUuid, subject: `id:rnet://id/${ownerUuid}` },
  });
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
    parser: "csv",
    parserVersion: "csv@1.1.0",
    originUuid,
    credentialUuid: null,
    provider: null,
    config: null,
    createdAt: new Date("2026-08-29T12:00:00.000Z"),
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
