import { describe, expect, test } from "bun:test";
import openapiTS, { astToString, type OpenAPI3 } from "openapi-typescript";
import ts from "typescript";

import { createApp } from "../src/app.ts";
import type { BlobStore } from "../src/blobs/index.ts";
import type { ServerConfig } from "../src/config.ts";
import type { Database } from "../src/db/index.ts";

const config: ServerConfig = {
  port: 3000,
  databaseUrl: "postgres://openapi.invalid/rhizome",
  authMode: "dev",
  baseUrl: "http://rhizome.test",
  allowedOrigins: [],
  maxRequestBodySize: 52_428_800,
  blob: {
    driver: "r2",
    endpoint: "https://openapi.invalid",
    accessKeyId: "unused",
    secretAccessKey: "unused",
    forcePathStyle: false,
    buckets: {
      elements: "elements",
      origins: "origins",
      bundles: "bundles",
      assets: "assets",
    },
  },
};

describe("OpenAPI", () => {
  const { app, openApiDocument } = createApp({
    config,
    db: {} as Database,
    blobs: {} as BlobStore,
  });

  test("discovers each route contract without external schema references", () => {
    const serialized = JSON.stringify(openApiDocument);
    expect(serialized).toContain('"operationId":"createMediaObjects"');
    expect(serialized).toContain('"/rnet/v0/elements/{id}/bytes"');
    expect(serialized).toContain('"BearerAuth":{"type":"http","scheme":"bearer"}');
    expect(serialized).not.toContain("https://rnet.network/schemas/0.1/");
  });

  test("serves the generated document", async () => {
    const response = await app.request("http://rhizome.test/rnet/v0/openapi.json");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(openApiDocument);
  });

  test("can generate a TypeScript client contract in memory", async () => {
    const mutableOpenApiDocument = JSON.parse(JSON.stringify(openApiDocument)) as OpenAPI3;
    const nodes = await openapiTS(mutableOpenApiDocument, {
      transform(schema) {
        if (schema.format === "binary") return ts.factory.createTypeReferenceNode("Blob");
        return undefined;
      },
    });
    const source = astToString(nodes);
    expect(source).toContain("export interface paths");
    expect(source).toContain('"/rnet/v0/vibes"');
    expect(source).toContain("Blob");
  });
});
