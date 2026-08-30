import { describe, expect, test } from "bun:test";
import openapiTS, { astToString, type OpenAPI3 } from "openapi-typescript";
import ts from "typescript";

import { createApp } from "../src/app.ts";
import type { BlobStore } from "../src/blobs/index.ts";
import type { ServerConfig } from "../src/config.ts";
import type { Database } from "../src/db/index.ts";
import { createCredentialKeyring } from "../src/services/source-credential-crypto.ts";

const config: ServerConfig = {
  port: 3000,
  databaseUrl: "postgres://openapi.invalid/rhizome",
  authMode: "dev",
  baseUrl: "http://rhizome.test",
  allowedOrigins: [],
  maxRequestBodySize: 52_428_800,
  sourceCredentials: {
    keyProvider: {
      driver: "local",
      keyring: createCredentialKeyring("test", { test: new Uint8Array(32) }),
    },
    simpleFinAllowedHosts: ["bridge.simplefin.test"],
  },
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
    expect(serialized).toContain('"operationId":"createIngestionSource"');
    expect(serialized).toContain('"operationId":"connectSimpleFin"');
    expect(serialized).toContain('"operationId":"getSourceCredential"');
    expect(serialized).toContain('"operationId":"revokeSourceCredential"');
    expect(serialized).toContain('"operationId":"createImportPreview"');
    expect(serialized).toContain('"operationId":"confirmImportPreview"');
    expect(serialized).toContain('"/rnet/v0/elements/{id}/bytes"');
    expect(serialized).toContain('"BearerAuth":{"type":"http","scheme":"bearer"}');
    expect(serialized).toContain('"name":"x-rnet-kind","in":"header","required":true');
    expect(serialized).toContain('"name":"x-rnet-label","in":"header","required":false');
    expect(serialized).not.toContain("https://rnet.network/schemas/0.1/");
  });

  test("documents optional identity and required authenticated operations", () => {
    expect(openApiDocument.security).toEqual([{ BearerAuth: [] }, {}]);
    const createVibe = openApiDocument.paths["/rnet/v0/vibes"]?.post as
      { security?: unknown } | undefined;
    expect(createVibe?.security).toEqual([{ BearerAuth: [] }]);

    const getVibe = openApiDocument.paths["/rnet/v0/vibes/{id}"]?.get as
      { security?: unknown } | undefined;
    expect(getVibe?.security).toBeUndefined();

    const getOperation = openApiDocument.paths["/rnet/v0/operations/{id}"]?.get as
      { responses?: Record<string, unknown> } | undefined;
    expect(Object.keys(getOperation?.responses ?? {})).toEqual(
      expect.arrayContaining(["401", "403", "404"]),
    );
  });

  test("documents arbitrary named multipart parts as binary files", () => {
    const createObjects = openApiDocument.paths["/rnet/v0/objects"]?.post as
      | {
          requestBody?: {
            content?: {
              "multipart/form-data"?: {
                schema?: Record<string, unknown>;
              };
            };
          };
        }
      | undefined;
    const schema = createObjects?.requestBody?.content?.["multipart/form-data"]?.schema;
    expect(schema?.additionalProperties).toEqual({ type: "string", format: "binary" });
    expect(schema?.["x-rhizome-typescript-type"]).toBe("FormData");
  });

  test("serves the generated document", async () => {
    const response = await app.request("http://rhizome.test/rnet/v0/openapi.json");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(openApiDocument);
  });

  test("enforces owner-only SimpleFIN connection input at the route boundary", async () => {
    const clientResponse = await app.request(
      "http://rhizome.test/rnet/v0/source-credentials/simplefin",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer dev:client:rbudget",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ setup_token: "unused" }),
      },
    );
    expect(clientResponse.status).toBe(403);

    const invalidResponse = await app.request(
      "http://rhizome.test/rnet/v0/source-credentials/simplefin",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer dev:user",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ setup_token: "unused", access_url: "secret" }),
      },
    );
    expect(invalidResponse.status).toBe(422);

    const ambiguousAccountSelector = await app.request(
      "http://rhizome.test/rnet/v0/ingestion-sources",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer dev:user",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          credential: "credential:0198f2a1-f5d0-7bee-aacd-4ba0aa096e07",
          config: { accounts: ["checking"] },
        }),
      },
    );
    expect(ambiguousAccountSelector.status).toBe(422);
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
