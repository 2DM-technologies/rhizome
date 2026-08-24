// rNet protocol semantics, exercised end to end over HTTP.
//
// These checks are named as RULES, not as behaviours: "no grant exposes origins", not
// "returns 403". A rule statement makes you ask whether the rule is right; a behaviour
// description only records what the code already does, which is how a suite stops
// catching anything. Keep the naming when you add to this file.
//
// Deliberately black-box: the only imports from ../src are the ones needed to stand the
// server up. Assertions go through HTTP and nothing else — no services, no models, no
// serializers, no direct database reads. That constraint is what let this suite catch a
// protocol gap the implementation's own tests agreed with.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  validateMediaObject,
  validateSchema,
  type MediaObject,
  type OriginArtifact,
  type Vibe,
} from "@rnet/types";
import S3rver from "s3rver";

import { createApp } from "../src/app.ts";
import { createBlobStore } from "../src/blobs/index.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase } from "../src/db/index.ts";
import { seedDb } from "../src/db/seedDb.ts";

const databaseUrl = process.env.RHIZOME_TEST_DATABASE_URL ?? "postgres://localhost/rhizome_m1_test";
const { db, client } = createDatabase(databaseUrl, { max: 1 });
const buckets = {
  elements: "elements",
  origins: "origins",
  bundles: "bundles",
  assets: "assets",
} as const;

const owner = { Authorization: "Bearer dev:user" };
const otherOwner = { Authorization: "Bearer dev:user:other" };
const dmachine = { Authorization: "Bearer dev:client:rbudget" };

let app: ReturnType<typeof createApp>["app"];
let s3: S3rver | undefined;
let scratch = "";

// State threaded between checks. Each test builds on the last, so this file is ordered.
let vibe: Vibe;
let vibeId: string;
let origin: OriginArtifact;
let createdObject: MediaObject;
let objectId: string;
let otherVibe: Vibe;
let otherOrigin: OriginArtifact;
let otherElement: { uri: string };
let otherObject: MediaObject;
let initialEtag = "0";
let userWriteEtag = "1";
const authoredPayload = "atomic client payload";

beforeAll(async () => {
  await client.unsafe(`
    TRUNCATE TABLE
      meter_entry, media_object_revisions, vibe_revisions, media_object_origins, media_object_elements,
      vibe_media_objects, grants, operations, media_objects, media_elements, origins, vibes, dmachines, users
    CASCADE
  `);
  scratch = await mkdtemp(join(tmpdir(), "rhizome-semantics-"));
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
  app = createApp({ config, db, blobs: createBlobStore(config) }).app;
  await seedDb(db);
});

afterAll(async () => {
  for (const [id, headers] of [
    [vibeId, owner],
    [otherVibe?.uri.split("/").at(-1), otherOwner],
  ] as const) {
    if (id)
      await request(`/rnet/v0/vibes/${id}`, { method: "DELETE", headers }).catch(() => undefined);
  }
  await s3?.close();
  await client.end();
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

describe("rNet semantics", () => {
  test("owner can create a Vibe", async () => {
    const response = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: {
        title: "rNet semantics",
        grants: [
          {
            subject: "client:rbudget",
            scope: ["read", "write:user", "write:objects", "write:inferred"],
          },
        ],
      },
    });
    expect(response.status).toBe(201);
    vibe = (await response.json()) as Vibe;
    vibeId = vibe.uri.split("/").at(-1)!;
  });

  test("a created Vibe conforms to its schema", () => {
    const validation = validateSchema("vibe", vibe);
    if (!validation.ok) expect(validation.issues).toEqual([]);
    expect(validation.ok).toBe(true);
  });

  test("a read grant is enforced positively", async () => {
    const response = await request(`/rnet/v0/vibes/${vibeId}`, { headers: dmachine });
    expect(response.status).toBe(200);
  });

  test("owner can upload an origin", async () => {
    const response = await request("/rnet/v0/origins", {
      method: "POST",
      headers: {
        ...owner,
        "Content-Type": "application/octet-stream",
        "X-Rnet-Label": "synthetic.bin",
      },
      body: new TextEncoder().encode(`synthetic-rnet-semantics-${vibeId}`),
    });
    expect(response.status).toBe(201);
    origin = (await response.json()) as OriginArtifact;
  });

  test("origin metadata conforms to its schema", () => {
    const validation = validateSchema("origin-artifact", origin);
    if (!validation.ok) expect(validation.issues).toEqual([]);
    expect(validation.ok).toBe(true);
  });

  test("owner can create an object grounded in an origin", async () => {
    const response = await createObjects(owner, {
      vibe: vibe.uri,
      objects: [
        {
          type: "transaction",
          elements: [],
          source: {
            ingest: { method: "parser", reproducible: true },
            origins: [origin.uri],
            properties: { amount: "-1.00", currency: "USD", raw_description: "SYNTHETIC" },
          },
          "x-rnet-semantics": { synthetic: true },
        },
      ],
    });
    expect(response.status).toBe(201);
    createdObject = ((await response.json()) as { mediaObjects: MediaObject[] }).mediaObjects[0]!;
    objectId = createdObject.uri.split("/").at(-1)!;
  });

  test("a created object conforms to its schema and registered vocabulary", () => {
    const validation = validateMediaObject(createdObject);
    if (!validation.ok) expect(validation.issues).toEqual([]);
    expect(validation.ok).toBe(true);
  });

  test("the store mints the object UUID", () => {
    expect(createdObject.uri).toMatch(
      /^rnet:\/\/object\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test("object creation rejects client-supplied identity fields", async () => {
    const response = await createObjects(dmachine, {
      vibe: vibe.uri,
      objects: [
        {
          rnet_schema: "0.1",
          uri: "rnet://object/018f1f4e-7b3a-7cc1-8b7a-123456789abc",
          owner: vibe.owner,
          type: "note",
          properties: {},
        },
      ],
    });
    expect(response.status).toBe(422);
  });

  test("write:objects cannot create a detached element", async () => {
    const response = await request("/rnet/v0/elements", {
      method: "POST",
      headers: { ...dmachine, "Content-Type": "text/plain", "X-Rnet-Kind": "text" },
      body: "detached client payload",
    });
    expect(response.status).toBe(403);
  });

  test("atomic creation rejects an unresolved upload descriptor", async () => {
    const response = await createObjects(dmachine, {
      vibe: vibe.uri,
      objects: [
        {
          type: "note",
          elements: [{ upload: "missing", kind: "text", mime: "text/plain" }],
          properties: { title: "Missing upload" },
        },
      ],
    });
    expect(response.status).toBe(422);
  });

  test("write:objects atomically creates an object and its element", async () => {
    const response = await createObjects(
      dmachine,
      {
        vibe: vibe.uri,
        objects: [
          {
            type: "note",
            elements: [{ upload: "body", kind: "text", mime: "text/plain" }],
            properties: { title: "Atomic note" },
          },
        ],
      },
      { body: { bytes: authoredPayload, mime: "text/plain" } },
    );
    expect(response.status).toBe(201);
    const authored = ((await response.json()) as { mediaObjects: MediaObject[] }).mediaObjects[0]!;
    const validation = validateMediaObject(authored);
    if (!validation.ok) expect(validation.issues).toEqual([]);

    const elementId = authored.elements[0]?.split("/").at(-1);
    expect(elementId).toBeDefined();
    const elementResponse = await request(`/rnet/v0/elements/${elementId}`, { headers: dmachine });
    expect(elementResponse.status).toBe(200);

    const element = (await elementResponse.json()) as { bytes: string; content_hash: string };
    const payload = await fetch(element.bytes);
    expect(payload.ok).toBe(true);
    expect(await payload.text()).toBe(authoredPayload);
    expect(element.content_hash).toBe(await sha256(new TextEncoder().encode(authoredPayload)));
  });

  test("a read grant reaches objects through Vibe membership", async () => {
    const response = await request(`/rnet/v0/objects/${objectId}`, { headers: dmachine });
    expect(response.status).toBe(200);
    initialEtag = response.headers.get("ETag") ?? "0";
  });

  test("write:user can update the user block", async () => {
    const response = await request(`/rnet/v0/objects/${objectId}/user`, {
      method: "PATCH",
      headers: { ...dmachine, "If-Match": initialEtag },
      json: { properties: { reviewed: true } },
    });
    expect(response.status).toBe(200);
    userWriteEtag = response.headers.get("ETag") ?? "1";
  });

  test("a stale user write fails with revision_conflict", async () => {
    const response = await request(`/rnet/v0/objects/${objectId}/user`, {
      method: "PATCH",
      headers: { ...dmachine, "If-Match": initialEtag },
      json: { properties: { reviewed: false } },
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe("revision_conflict");
  });

  test("write:user cannot write source", async () => {
    const response = await request(`/rnet/v0/objects/${objectId}/user`, {
      method: "PATCH",
      headers: { ...dmachine, "If-Match": userWriteEtag },
      json: { properties: {}, source: { properties: { corrupted: true } } },
    });
    expect(response.status).toBe(422);
  });

  test("no grant exposes origins", async () => {
    const response = await request(`/rnet/v0/origins/${origin.uri.split("/").at(-1)}`, {
      headers: dmachine,
    });
    expect(response.status).toBe(403);
  });

  test("write:inferred cannot spoof another writer's namespace", async () => {
    const response = await request(`/rnet/v0/objects/${objectId}/inferred`, {
      method: "PUT",
      headers: dmachine,
      json: { task: "rhizome:spoof", entry: { model: "semantics/test", properties: {} } },
    });
    expect(response.status).toBe(403);
  });

  test("client task output cannot mark itself durable", async () => {
    const response = await request(`/rnet/v0/objects/${objectId}/inferred`, {
      method: "PUT",
      headers: dmachine,
      json: { task: "forecast", entry: { model: "semantics/test", durable: true, properties: {} } },
    });
    expect(response.status).toBe(422);
  });

  test("a direct user inference is keyed to the user's UUID namespace", async () => {
    const response = await request(`/rnet/v0/objects/${objectId}/inferred`, {
      method: "PUT",
      headers: owner,
      json: {
        task: "correction",
        entry: { model: "user/direct", durable: true, properties: { corrected: true } },
      },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as MediaObject;
    expect(body.inferred?.[`user/${vibe.owner.split("/").at(-1)}:correction`]).toBeDefined();
  });

  test("a second owner can create a Vibe, an origin, an element, and an object", async () => {
    const vibeResponse = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: otherOwner,
      json: { title: "Other owner" },
    });
    expect(vibeResponse.status).toBe(201);
    otherVibe = (await vibeResponse.json()) as Vibe;

    const originResponse = await request("/rnet/v0/origins", {
      method: "POST",
      headers: { ...otherOwner, "Content-Type": "text/plain" },
      body: "other owner origin",
    });
    expect(originResponse.status).toBe(201);
    otherOrigin = (await originResponse.json()) as OriginArtifact;

    const elementResponse = await request("/rnet/v0/elements", {
      method: "POST",
      headers: { ...otherOwner, "Content-Type": "text/plain", "X-Rnet-Kind": "text" },
      body: "other owner element",
    });
    expect(elementResponse.status).toBe(201);
    otherElement = (await elementResponse.json()) as { uri: string };

    const objectResponse = await createObjects(otherOwner, {
      vibe: otherVibe.uri,
      objects: [
        {
          type: "note",
          elements: [],
          source: {
            ingest: { method: "parser", reproducible: true },
            origins: [otherOrigin.uri],
            properties: { title: "Other owner's object" },
          },
        },
      ],
    });
    expect(objectResponse.status).toBe(201);
    otherObject = ((await objectResponse.json()) as { mediaObjects: MediaObject[] })
      .mediaObjects[0]!;
  });

  test("cross-owner element references are rejected", async () => {
    const response = await createObjects(owner, {
      vibe: vibe.uri,
      objects: [
        {
          type: "note",
          elements: [otherElement.uri],
          source: {
            ingest: { method: "parser", reproducible: true },
            origins: [origin.uri],
            properties: {},
          },
        },
      ],
    });
    expect(response.status).toBe(403);
  });

  test("cross-owner origin references are rejected", async () => {
    const response = await createObjects(owner, {
      vibe: vibe.uri,
      objects: [
        {
          type: "note",
          elements: [],
          source: {
            ingest: { method: "parser", reproducible: true },
            origins: [otherOrigin.uri],
            properties: {},
          },
        },
      ],
    });
    expect(response.status).toBe(403);
  });

  test("cross-owner object attachment is rejected", async () => {
    const response = await request(`/rnet/v0/vibes/${vibeId}/objects`, {
      method: "POST",
      headers: owner,
      json: { objects: [otherObject.uri] },
    });
    expect(response.status).toBe(403);
  });

  test("write:objects cannot attach a pre-existing object", async () => {
    const response = await request(`/rnet/v0/vibes/${vibeId}/objects`, {
      method: "POST",
      headers: dmachine,
      json: { objects: [createdObject.uri] },
    });
    expect(response.status).toBe(403);
  });

  test("Vibe object expansion preserves batch order", async () => {
    const batchResponse = await createObjects(owner, {
      vibe: vibe.uri,
      objects: ["first", "second"].map((title) => ({
        type: "note",
        elements: [],
        source: {
          ingest: { method: "parser", reproducible: true },
          origins: [origin.uri],
          properties: { title },
        },
      })),
    });
    expect(batchResponse.status).toBe(201);
    const batch = ((await batchResponse.json()) as { mediaObjects: MediaObject[] }).mediaObjects;

    const expanded = await request(`/rnet/v0/vibes/${vibeId}/objects?expand=full`, {
      headers: owner,
    });
    expect(expanded.status).toBe(200);
    const expandedObjects = ((await expanded.json()) as { mediaObjects: MediaObject[] })
      .mediaObjects;
    expect(expandedObjects.slice(-2).map((item) => item.uri)).toEqual(
      batch.map((item) => item.uri),
    );
  });

  test("revoking a grant fails closed on the next request", async () => {
    const revoke = await request(`/rnet/v0/vibes/${vibeId}`, {
      method: "PATCH",
      headers: owner,
      json: { grants: [] },
    });
    expect(revoke.status).toBe(200);
    const read = await request(`/rnet/v0/vibes/${vibeId}`, { headers: dmachine });
    expect(read.status).toBe(403);
  });
});

async function createObjects(
  headers: Record<string, string>,
  metadata: unknown,
  uploads: Record<string, { bytes: string; mime: string }> = {},
): Promise<Response> {
  return request("/rnet/v0/objects", { method: "POST", headers, json: metadata, uploads });
}

async function request(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    json?: unknown;
    body?: BodyInit;
    uploads?: Record<string, { bytes: string; mime: string }>;
  } = {},
): Promise<Response> {
  const url = `http://rhizome.test${path}`;
  if (
    path.startsWith("/rnet/v0/objects") &&
    options.method === "POST" &&
    options.json !== undefined
  ) {
    const form = new FormData();
    form.set("metadata", JSON.stringify(options.json));
    for (const [name, upload] of Object.entries(options.uploads ?? {})) {
      form.set(name, new Blob([upload.bytes], { type: upload.mime }), name);
    }
    return app.request(url, { method: "POST", headers: options.headers, body: form });
  }
  return app.request(url, {
    method: options.method,
    headers: {
      ...(options.json === undefined ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
    body: options.json === undefined ? options.body : JSON.stringify(options.json),
  });
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return `sha256:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
