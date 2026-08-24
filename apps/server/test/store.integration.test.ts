import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runStoreConformance } from "@rnet/conformance";
import S3rver from "s3rver";

import { createApp } from "../src/app.ts";
import { createBlobStore } from "../src/blobs/index.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase } from "../src/db/index.ts";

const databaseUrl = process.env.RHIZOME_TEST_DATABASE_URL ?? "postgres://localhost/rhizome_m1_test";
const { db, client } = createDatabase(databaseUrl, { max: 1 });
let scratch = "";
let s3: S3rver | undefined;
let app: ReturnType<typeof createApp>["app"];

const buckets = {
  elements: "elements",
  origins: "origins",
  bundles: "bundles",
  assets: "assets",
} as const;

const owner = { Authorization: "Bearer dev:user" };
const machine = { Authorization: "Bearer dev:client:rbudget" };

beforeAll(async () => {
  await client.unsafe(`
    TRUNCATE TABLE
      meter, media_object_revisions, vibe_revisions, media_object_origins, media_object_elements,
      vibe_media_objects, grants, operations, media_objects, media_elements, origins, vibes, machines, users
    CASCADE
  `);
  scratch = await mkdtemp(join(tmpdir(), "rhizome-s3-"));
  s3 = new S3rver({
    address: "127.0.0.1",
    port: 0,
    silent: true,
    directory: join(scratch, "storage"),
    configureBuckets: Object.values(buckets).map((name) => ({ name, configs: [] })),
  });
  const address = await s3.run();
  const config: ServerConfig = {
    port: 3000,
    databaseUrl,
    authMode: "dev",
    baseUrl: "http://rhizome.test",
    allowedOrigins: ["http://rhizome.test"],
    maxRequestBodySize: 52_428_800,
    blob: {
      driver: "r2",
      endpoint: `http://${address.address}:${address.port}`,
      accessKeyId: "S3RVER",
      secretAccessKey: "S3RVER",
      forcePathStyle: true,
      buckets,
    },
  };
  const created = createApp({
    config,
    db,
    blobs: createBlobStore(config),
  });
  app = created.app;
  await created.identityService.seedDevelopmentIdentities();
});

afterAll(async () => {
  await s3?.close();
  await client.end();
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

describe("rNet M1 store", () => {
  let vibeId = "";
  let mediaObjectId = "";
  let originUri = "";
  let originHash = "";

  test("rejects anonymous Vibe creation", async () => {
    const response = await request("/rnet/v0/vibes", { method: "POST", json: { title: "Nope" } });
    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toContain("application/problem+json");
  });

  test("validates JSON request schemas at the route boundary", async () => {
    const extraProperty = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: { title: "Nope", source: {} },
    });
    expect(extraProperty.status).toBe(422);

    const malformed = await app.request("http://rhizome.test/rnet/v0/vibes", {
      method: "POST",
      headers: { ...owner, "Content-Type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(422);
    expect(malformed.headers.get("Content-Type")).toContain("application/problem+json");

    const invalidPath = await request("/rnet/v0/elements/not-a-uuid", { headers: owner });
    expect(invalidPath.status).toBe(422);
    expect(invalidPath.headers.get("Content-Type")).toContain("application/problem+json");
  });

  test("creates a Vibe with a real machine grant", async () => {
    const response = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: {
        title: "Spending",
        grants: [
          {
            subject: "client:rbudget",
            scope: ["read", "write:user", "write:objects", "write:inferred"],
          },
        ],
      },
    });
    expect(response.status).toBe(201);
    const vibe = await response.json();
    expect(vibe.title).toBe("Spending");
    expect(vibe.owner).toBe("rnet://id/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47");
    vibeId = vibe.uri.split("/").at(-1);
  });

  test("rejects grant subjects the store cannot resolve", async () => {
    const response = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: { title: "Bad grant", grants: [{ subject: "x-ghost:anyone", scope: ["read"] }] },
    });
    expect(response.status).toBe(422);
  });

  test("creates distinct owned origin records while deduplicating payload bytes", async () => {
    const first = await app.request("http://rhizome.test/rnet/v0/origins", {
      method: "POST",
      headers: { ...owner, "Content-Type": "application/json", "X-Rnet-Label": "bank.json" },
      body: '{"transactions":[]}',
    });
    expect(first.status).toBe(201);
    const origin = await first.json();
    originUri = origin.uri;
    originHash = origin.content_hash;
    expect(origin.owner).toBe("rnet://id/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47");
    expect(origin.uri).toMatch(/^rnet:\/\/origin\/[0-9a-f-]{36}$/);
    const second = await app.request("http://rhizome.test/rnet/v0/origins", {
      method: "POST",
      headers: { ...owner, "Content-Type": "application/json" },
      body: '{"transactions":[]}',
    });
    expect(second.status).toBe(201);
    const duplicate = await second.json();
    expect(duplicate.uri).not.toBe(originUri);
    expect(duplicate.content_hash).toBe(originHash);
  });

  test("creates a conformant transaction and attaches it to the Vibe", async () => {
    const response = await request("/rnet/v0/objects", {
      method: "POST",
      headers: owner,
      json: {
        vibe: `rnet://vibe/${vibeId}`,
        objects: [
          {
            type: "transaction",
            elements: [],
            source: {
              ingest: { method: "parser", reproducible: true },
              origins: [originUri],
              properties: { amount: "-6.50", currency: "USD", raw_description: "COFFEE SHOP" },
            },
          },
        ],
      },
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    mediaObjectId = body.mediaObjects[0].uri.split("/").at(-1);
    expect(body.mediaObjects[0].owner).toBe("rnet://id/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47");
  });

  test("preserves batch insertion order with unique Vibe positions", async () => {
    const response = await request("/rnet/v0/objects", {
      method: "POST",
      headers: owner,
      json: {
        vibe: `rnet://vibe/${vibeId}`,
        objects: [0, 1].map((index) => ({
          type: "note",
          elements: [],
          source: {
            ingest: { method: "parser", reproducible: true },
            origins: [originUri],
            properties: { title: `Ordered ${index + 1}` },
          },
        })),
      },
    });
    expect(response.status).toBe(201);
    const uris = (await response.json()).mediaObjects.map((item: { uri: string }) => item.uri);
    const listed = await (
      await request(`/rnet/v0/vibes/${vibeId}/objects`, { headers: owner })
    ).json();
    expect(listed.mediaObjects.slice(-2).map((item: { uri: string }) => item.uri)).toEqual(uris);
    const positions = await client.unsafe(
      "select position from vibe_media_objects where vibe_uuid = $1 order by position",
      [vibeId],
    );
    expect(positions.map((row) => row.position)).toEqual([0, 1, 2]);
  });

  test("lets a granted machine read but never exposes origins", async () => {
    const vibe = await request(`/rnet/v0/vibes/${vibeId}`, { headers: machine });
    expect(vibe.status).toBe(200);
    const mediaObjectResponse = await request(`/rnet/v0/objects/${mediaObjectId}`, {
      headers: machine,
    });
    expect(mediaObjectResponse.status).toBe(200);
    expect(mediaObjectResponse.headers.get("ETag")).toBe('"0"');
    const origin = await request(`/rnet/v0/origins/${originUri.split("/").at(-1)}`, {
      headers: machine,
    });
    expect(origin.status).toBe(403);
  });

  test("revision-protects machine writes and refuses source-shaped fields", async () => {
    const update = await request(`/rnet/v0/objects/${mediaObjectId}/user`, {
      method: "PATCH",
      headers: { ...machine, "If-Match": "0" },
      json: { properties: { category: "coffee" } },
    });
    expect(update.status).toBe(200);
    expect(update.headers.get("ETag")).toBe('"1"');

    const stale = await request(`/rnet/v0/objects/${mediaObjectId}/user`, {
      method: "PATCH",
      headers: { ...machine, "If-Match": "0" },
      json: { properties: { category: "food" } },
    });
    expect(stale.status).toBe(409);

    const corrupt = await request(`/rnet/v0/objects/${mediaObjectId}/user`, {
      method: "PATCH",
      headers: { ...machine, "If-Match": "1" },
      json: { properties: {}, source: { properties: { amount: 0 } } },
    });
    expect(corrupt.status).toBe(422);
    const unchanged = await (
      await request(`/rnet/v0/objects/${mediaObjectId}`, { headers: machine })
    ).json();
    expect(unchanged.source.properties.amount).toBe("-6.50");
  });

  test("server-grounds client-authored objects and prefixes inference", async () => {
    const detachedUpload = await app.request("http://rhizome.test/rnet/v0/elements", {
      method: "POST",
      headers: { ...machine, "Content-Type": "text/plain", "X-Rnet-Kind": "text" },
      body: "Detached machine upload",
    });
    expect(detachedUpload.status).toBe(403);

    const [beforeRejectedUpload] = await client.unsafe(
      "select count(*)::int as elements from media_elements",
    );
    const missingUpload = await request("/rnet/v0/objects", {
      method: "POST",
      headers: machine,
      json: {
        vibe: `rnet://vibe/${vibeId}`,
        objects: [
          {
            type: "note",
            elements: [{ upload: "missing", kind: "text", mime: "text/plain" }],
            properties: { title: "Must not commit" },
          },
        ],
      },
    });
    expect(missingUpload.status).toBe(422);
    const [afterRejectedUpload] = await client.unsafe(
      "select count(*)::int as elements from media_elements",
    );
    expect(afterRejectedUpload?.elements).toBe(beforeRejectedUpload?.elements);

    const created = await request("/rnet/v0/objects", {
      method: "POST",
      headers: machine,
      json: {
        vibe: `rnet://vibe/${vibeId}`,
        objects: [
          {
            type: "note",
            elements: [{ upload: "note", kind: "text", mime: "text/plain" }],
            properties: { title: "Machine-authored" },
          },
        ],
      },
      uploads: {
        note: { bytes: "A machine-authored note", mime: "text/plain" },
      },
    });
    expect(created.status).toBe(201);
    const document = (await created.json()).mediaObjects[0];
    expect(document.owner).toBe("rnet://id/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47");
    expect(document.source.ingest).toEqual({ method: "authored", reproducible: false });
    expect(document.source.origins).toEqual(["rnet://client/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b48"]);
    const mediaElementUri = document.elements[0];
    expect(mediaElementUri).toMatch(/^rnet:\/\/element\/[0-9a-f-]{36}$/);
    const mediaElementRead = await request(
      `/rnet/v0/elements/${mediaElementUri.split("/").at(-1)}`,
      { headers: machine },
    );
    expect(mediaElementRead.status).toBe(200);
    const mediaElement = await mediaElementRead.json();
    expect(mediaElement.owner).toBe(document.owner);
    expect(mediaElement.content_hash).toMatch(/^sha256:[a-f0-9]{64}$/);

    const inferred = await request(`/rnet/v0/objects/${mediaObjectId}/inferred`, {
      method: "PUT",
      headers: machine,
      json: { task: "forecast", entry: { model: "test/model", properties: { next: 42 } } },
    });
    expect(inferred.status).toBe(200);
    expect((await inferred.json()).inferred["rbudget:forecast"].properties.next).toBe(42);

    const spoof = await request(`/rnet/v0/objects/${mediaObjectId}/inferred`, {
      method: "PUT",
      headers: machine,
      json: { task: "rhizome:forecast", entry: { model: "test/model", properties: {} } },
    });
    expect(spoof.status).toBe(403);

    const durableTask = await request(`/rnet/v0/objects/${mediaObjectId}/inferred`, {
      method: "PUT",
      headers: machine,
      json: {
        task: "forecast",
        entry: { model: "test/model", durable: true, properties: {} },
      },
    });
    expect(durableTask.status).toBe(422);

    const userInference = await request(`/rnet/v0/objects/${mediaObjectId}/inferred`, {
      method: "PUT",
      headers: owner,
      json: {
        task: "correction",
        entry: { model: "user/direct", durable: true, properties: { category: "coffee" } },
      },
    });
    expect(userInference.status).toBe(200);
    expect(
      (await userInference.json()).inferred["user/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47:correction"]
        .properties.category,
    ).toBe("coffee");
  });

  test("does not treat same-owner record identifiers as machine capabilities", async () => {
    const privateVibeResponse = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: { title: "Private" },
    });
    const privateVibe = await privateVibeResponse.json();
    const privateObjectResponse = await request("/rnet/v0/objects", {
      method: "POST",
      headers: owner,
      json: {
        vibe: privateVibe.uri,
        objects: [
          {
            type: "note",
            elements: [],
            source: {
              ingest: { method: "parser", reproducible: true },
              origins: [originUri],
              properties: { title: "Private note" },
            },
          },
        ],
      },
    });
    const privateObject = (await privateObjectResponse.json()).mediaObjects[0];
    const attachKnownObject = await request(`/rnet/v0/vibes/${vibeId}/objects`, {
      method: "POST",
      headers: machine,
      json: { objects: [privateObject.uri] },
    });
    expect(attachKnownObject.status).toBe(403);

    const privateElementResponse = await app.request("http://rhizome.test/rnet/v0/elements", {
      method: "POST",
      headers: { ...owner, "Content-Type": "text/plain", "X-Rnet-Kind": "text" },
      body: "Owner-private payload",
    });
    const privateElement = await privateElementResponse.json();
    const attachKnownElement = await request("/rnet/v0/objects", {
      method: "POST",
      headers: machine,
      json: {
        vibe: `rnet://vibe/${vibeId}`,
        objects: [{ type: "note", elements: [privateElement.uri], properties: {} }],
      },
    });
    expect(attachKnownElement.status).toBe(403);
  });

  test("deletes a Vibe without deleting machine-created records", async () => {
    const disposableVibeResponse = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: {
        title: "Disposable",
        grants: [{ subject: "client:rbudget", scope: ["read", "write:objects"] }],
      },
    });
    const disposableVibe = await disposableVibeResponse.json();
    const disposableVibeId = disposableVibe.uri.split("/").at(-1);

    const mediaObjectResponse = await request("/rnet/v0/objects", {
      method: "POST",
      headers: machine,
      json: {
        vibe: disposableVibe.uri,
        objects: [
          {
            type: "note",
            elements: [{ upload: "retained", kind: "text", mime: "text/plain" }],
            properties: { title: "Retained" },
          },
        ],
      },
      uploads: {
        retained: { bytes: "Retained after Vibe deletion", mime: "text/plain" },
      },
    });
    expect(mediaObjectResponse.status).toBe(201);
    const mediaObject = (await mediaObjectResponse.json()).mediaObjects[0];
    const retainedMediaElementUuid = mediaObject.elements[0].split("/").at(-1);
    const retainedMediaObjectUuid = mediaObject.uri.split("/").at(-1);

    expect(
      (await request(`/rnet/v0/vibes/${disposableVibeId}`, { method: "DELETE", headers: owner }))
        .status,
    ).toBe(204);
    const retained = await client.unsafe(
      `select
         exists(select 1 from media_elements where uuid = $1) as element_exists,
         exists(select 1 from media_objects where uuid = $2) as object_exists`,
      [retainedMediaElementUuid, retainedMediaObjectUuid],
    );
    expect(retained[0]?.element_exists).toBe(true);
    expect(retained[0]?.object_exists).toBe(true);
  });

  test("revocation fails closed on the next request", async () => {
    const patched = await request(`/rnet/v0/vibes/${vibeId}`, {
      method: "PATCH",
      headers: owner,
      json: { grants: [] },
    });
    expect(patched.status).toBe(200);
    expect((await request(`/rnet/v0/vibes/${vibeId}`, { headers: machine })).status).toBe(403);
    const audit = await client.unsafe(
      `select revoked_at is not null as revoked from grants where vibe_uuid = $1 and subject = 'client:rbudget'`,
      [vibeId],
    );
    expect(audit[0]?.revoked).toBe(true);
  });

  test("passes the independent rNet HTTP conformance suite", async () => {
    const summary = await runStoreConformance({
      target: "http://rhizome.test",
      ownerToken: "dev:user",
      otherOwnerToken: "dev:user:other",
      clientToken: "dev:client:rbudget",
      fetch: async (input, init) => app.request(input, init),
      payloadFetch: globalThis.fetch.bind(globalThis),
    });
    expect(
      summary.failed,
      JSON.stringify(
        summary.checks.filter((check) => !check.passed),
        null,
        2,
      ),
    ).toBe(0);
    expect(summary.skipped).toBe(0);
  });
});

async function request(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    json?: unknown;
    uploads?: Record<string, { bytes: string | Uint8Array; mime: string }>;
  } = {},
): Promise<Response> {
  if (path === "/rnet/v0/objects" && options.json !== undefined) {
    const form = new FormData();
    form.set("metadata", JSON.stringify(options.json));
    for (const [name, upload] of Object.entries(options.uploads ?? {})) {
      const bytes =
        typeof upload.bytes === "string"
          ? upload.bytes
          : (upload.bytes.slice().buffer as ArrayBuffer);
      form.set(name, new Blob([bytes], { type: upload.mime }), name);
    }
    return app.request(`http://rhizome.test${path}`, {
      method: options.method,
      headers: options.headers,
      body: form,
    });
  }
  const headers = {
    ...(options.json === undefined ? {} : { "Content-Type": "application/json" }),
    ...options.headers,
  };
  return app.request(`http://rhizome.test${path}`, {
    method: options.method,
    headers,
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
  });
}
