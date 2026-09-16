import { describe, expect, test } from "bun:test";
import openapiTS, { astToString, type OpenAPI3 } from "openapi-typescript";
import ts from "typescript";

import { FileSourceCatalog } from "../../ingest/file-sources/types.ts";
import {
  CANDIDATE_BUNDLE_CAPABILITY,
  candidateBundle,
} from "../../ingest/source-skills/candidate-bundle.ts";
import { CONTENT_IMPORT_PUSH_PIPELINE } from "../../ingest/source-skills/import-push-pipelines.ts";
import { createApp } from "../src/app.ts";
import type { BlobStore } from "../src/blobs/index.ts";
import type { ServerConfig } from "../src/config.ts";
import type { Database, ProviderLeasePool } from "../src/db/index.ts";
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
    sources: { simplefin: { allowedHosts: ["bridge.simplefin.test"] } },
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
const providerLeasePool = {} as ProviderLeasePool;

describe("OpenAPI", () => {
  const { app, openApiDocument } = createApp({
    config,
    db: {} as Database,
    blobs: {} as BlobStore,
    providerLeasePool,
  });

  test("discovers each route contract without external schema references", () => {
    const serialized = JSON.stringify(openApiDocument);
    expect(serialized).toContain('"operationId":"createMediaObjects"');
    expect(serialized).toContain('"operationId":"createIngestionSource"');
    expect(serialized).toContain('"operationId":"connectSourceCredential"');
    expect(serialized).not.toContain('"operationId":"connectSimpleFin"');
    expect(serialized).toContain('"operationId":"listSourceSkills"');
    expect(serialized).toContain('"operationId":"getSourceCredential"');
    expect(serialized).toContain('"operationId":"revokeSourceCredential"');
    expect(serialized).toContain('"operationId":"createImportPreview"');
    expect(serialized).toContain('"operationId":"confirmImportPreview"');
    expect(serialized).toContain('"operationId":"getDashboardStats"');
    expect(serialized).toContain('"/rnet/v0/elements/{id}/bytes"');
    expect(serialized).toContain('"BearerAuth":{"type":"http","scheme":"bearer"}');
    expect(serialized).toContain('"name":"x-rnet-kind","in":"header","required":true');
    expect(serialized).toContain('"name":"x-rnet-label","in":"header","required":false');
    expect(serialized).not.toContain("https://rnet.network/schemas/0.1/");
    expect(serialized).not.toContain('"x-rhizome-');
  });

  test("documents optional identity and required authenticated operations", () => {
    expect(openApiDocument.security).toEqual([{ BearerAuth: [] }, {}]);
    const createVibe = openApiDocument.paths["/rnet/v0/vibes"]?.post as
      { security?: unknown } | undefined;
    expect(createVibe?.security).toEqual([{ BearerAuth: [] }]);

    const getDashboardStats = openApiDocument.paths["/rnet/v0/me/stats"]?.get as
      { security?: unknown } | undefined;
    expect(getDashboardStats?.security).toEqual([{ BearerAuth: [] }]);

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
    expect(schema?.required).toEqual(["metadata"]);
  });

  test("serves the generated document", async () => {
    const response = await app.request("http://rhizome.test/rnet/v0/openapi.json");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(openApiDocument);
  });

  test("serves serializable source-skill manifests without provider code in the host", async () => {
    const response = await app.request("http://rhizome.test/rnet/v0/source-skills", {
      headers: { Authorization: "Bearer dev:user" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      skills: expect.arrayContaining([
        expect.objectContaining({
          skill_id: "ofx",
          source_kind: "file",
          parser: { name: "ofx", version: "ofx@1.1.0" },
        }),
        expect.objectContaining({
          skill_id: "simplefin",
          label: "SimpleFIN",
          source_kind: "credentialed_remote",
          connector_version: "simplefin-connector@1.0.0",
          parser: { name: "simplefin", version: "simplefin@2.0.0" },
          review_actions: ["review_import", "refresh_source"],
          import_push_pipeline: [],
        }),
        expect.objectContaining({
          skill_id: "arena",
          label: "Are.na channel",
          source_kind: "public_remote",
          connector_version: "arena-connector@1.0.0",
          parser: { name: "arena", version: "arena@1.2.0" },
          review_actions: ["review_import", "refresh_source"],
          import_push_pipeline: CONTENT_IMPORT_PUSH_PIPELINE,
        }),
      ]),
    });
  });

  test("uses one injected file catalog for manifests and source creation", async () => {
    const parser = {
      name: "custom-file-parser",
      version: "custom-file-parser@0.0.0-test",
      async parse() {
        return { transactions: [], sourceRecordCount: 0 };
      },
    };
    const fileSources = new FileSourceCatalog([
      {
        manifest: {
          skill_id: "custom_file",
          label: "Custom file",
          description: "A custom injected file source",
          source_kind: "file",
          connector_version: "origin-upload@test",
          parser: { name: parser.name, version: parser.version },
          limits: {
            maxCandidates: 10,
            maxCaptureBytes: 1_024,
            maxElementBytes: 512,
            maxTotalElementBytes: 1_024,
          },
          input_fields: [
            {
              name: "file",
              label: "Custom file",
              target: "source",
              control: "file",
              required: true,
              secret: false,
            },
          ],
          review_actions: ["review_import"],
          import_push_pipeline: [],
        },
        parser,
        compiledSource: {
          kind: CANDIDATE_BUNDLE_CAPABILITY,
          async compile() {
            return candidateBundle([], { ok: true, checks: [] });
          },
        },
      },
    ]);
    const injected = createApp({
      config,
      db: {} as Database,
      blobs: {} as BlobStore,
      providerLeasePool,
      fileSources,
    }).app;

    const manifests = (await (
      await injected.request("http://rhizome.test/rnet/v0/source-skills", {
        headers: { Authorization: "Bearer dev:user" },
      })
    ).json()) as { skills: Array<{ skill_id: string }> };
    expect(manifests.skills.map(({ skill_id }) => skill_id)).toEqual([
      "custom_file",
      "simplefin",
      "arena",
    ]);

    const omittedBuiltIn = await injected.request("http://rhizome.test/rnet/v0/ingestion-sources", {
      method: "POST",
      headers: { Authorization: "Bearer dev:user", "Content-Type": "application/json" },
      body: JSON.stringify({
        origin: "rnet://origin/0198f2a1-a001-7a01-8001-000000000001",
        skill_id: "csv",
      }),
    });
    expect(omittedBuiltIn.status).toBe(422);
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

    const uninstalledResponse = await app.request(
      "http://rhizome.test/rnet/v0/source-credentials/uninstalled",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer dev:user",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ claim: "unused" }),
      },
    );
    expect(uninstalledResponse.status).toBe(422);

    const invalidProviderConfig = await app.request(
      "http://rhizome.test/rnet/v0/ingestion-sources",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer dev:user",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          credential: "credential:0198f2a1-f5d0-7bee-aacd-4ba0aa096e07",
          config: [],
        }),
      },
    );
    expect(invalidProviderConfig.status).toBe(422);
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
