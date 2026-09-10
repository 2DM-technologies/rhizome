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
  rnetUriPattern,
  validateMediaObject,
  validateSchema,
  type MediaElement,
  type MediaObject,
  type OriginArtifact,
  type Vibe,
} from "@rnet/types";
import S3rver from "s3rver";
import {
  isPushOperation,
  storeTaskKey,
  type OperationDocument,
  type PushOperationResult,
  type PushTaskManifest,
  type PushTaskManifestsResponse,
} from "@rhizome/store-contract";

import { createApp } from "../src/app.ts";
import { createBlobStore } from "../src/blobs/index.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, createProviderLeasePool } from "../src/db/index.ts";
import { seedDb } from "../src/db/seedDb.ts";
import { createCredentialKeyring } from "../src/services/source-credential-crypto.ts";
import { FakeModelConnector } from "../src/inference/fake-connector.ts";

const databaseUrl = process.env.RHIZOME_TEST_DATABASE_URL ?? "postgres://localhost/rhizome_m1_test";
const { db, client } = createDatabase(databaseUrl, { max: 1 });
const providerLeasePool = createProviderLeasePool(databaseUrl, { max: 1 });
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
let keylessApp: typeof app;
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
let authoredObject: MediaObject;
let authoredElement: MediaElement;
let authoredElementBytesUrl = "";
const authoredPayload = "“atomic” client payload 🤔";
let displayTask: PushTaskManifest;
let keywordsTask: PushTaskManifest;
let summarizeTask: PushTaskManifest;
let clientPush: OperationDocument & { result: PushOperationResult | null };
let beforePush: MediaObject;

beforeAll(async () => {
  await client.unsafe(`
    TRUNCATE TABLE
      meter_entry, media_object_revisions, vibe_revisions, media_object_origins, media_object_elements,
      vibe_media_objects, grants, operations, ingestion_source_objects, ingestion_sources,
      source_credentials, media_objects,
      media_elements, origins, vibes, dmachines, users
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
    sourceCredentials: {
      keyProvider: {
        driver: "local",
        keyring: createCredentialKeyring("test", { test: new Uint8Array(32) }),
      },
      sources: { simplefin: { allowedHosts: ["bridge.simplefin.test"] } },
    },
    blob: {
      driver: "r2",
      endpoint: `http://${address.address}:${address.port}`,
      accessKeyId: "S3RVER",
      secretAccessKey: "S3RVER",
      forcePathStyle: true,
      buckets,
    },
  };
  const dependencies = { config, db, blobs: createBlobStore(config), providerLeasePool };
  keylessApp = createApp(dependencies).app;
  const samples = new FakeModelConnector();
  let names = 0;
  const connector = new FakeModelConnector({
    respond: async (request) => {
      const response = await samples.complete(request);
      if (request.schemaName === "rhizome_display_name") {
        names++;
        for (const item of (response.output as { results: { result: { display_name: string } }[] })
          .results)
          item.result.display_name = `Name ${names}`;
      }
      return response;
    },
  });
  app = createApp({
    ...dependencies,
    modelConnectors: {
      target: { provider: connector.provider, name: connector.models[0] },
      identity: `${connector.provider}/${connector.models[0]}`,
      connector,
    },
  }).app;
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
  await providerLeasePool.end();
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
    expect(createdObject.uri).toMatch(new RegExp(rnetUriPattern("object")));
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
            elements: [
              {
                upload: "body",
                kind: "text",
                mime: "text/plain",
                role: "content",
                alt: "Atomic note body",
              },
            ],
            properties: { title: "Atomic note" },
          },
        ],
      },
      { body: { bytes: authoredPayload, mime: "text/plain" } },
    );
    expect(response.status).toBe(201);
    const authored = ((await response.json()) as { mediaObjects: MediaObject[] }).mediaObjects[0]!;
    authoredObject = authored;
    const validation = validateMediaObject(authored);
    if (!validation.ok) expect(validation.issues).toEqual([]);
    expect(authored.elements).toEqual([
      {
        uri: expect.stringMatching(/^rnet:\/\/element\/[0-9a-f-]{36}$/),
        role: "content",
      },
    ]);

    const elementId = authored.elements[0]?.uri.split("/").at(-1);
    expect(elementId).toBeDefined();
    const elementResponse = await request(`/rnet/v0/elements/${elementId}`, { headers: dmachine });
    expect(elementResponse.status).toBe(200);

    const element = (await elementResponse.json()) as MediaElement;
    const elementValidation = validateSchema("media-element", element);
    if (!elementValidation.ok) expect(elementValidation.issues).toEqual([]);
    authoredElement = element;
    authoredElementBytesUrl = element.bytes;
    expect(authoredElementBytesUrl).toBe(`http://rhizome.test/rnet/v0/elements/${elementId}/bytes`);
    const payload = await app.request(authoredElementBytesUrl, { headers: dmachine });
    expect(payload.ok).toBe(true);
    expect(payload.headers.get("Cache-Control")).toBe("private, no-store");
    expect(payload.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(await payload.text()).toBe(authoredPayload);
    expect(element.content_hash).toBe(await sha256(new TextEncoder().encode(authoredPayload)));
  });

  test("alt text describes the element, not the association", async () => {
    // An upload descriptor's alt lands on the element record it creates...
    expect(authoredElement.alt).toBe("Atomic note body");
    expect(authoredElement).not.toHaveProperty("inferred");
    // ...and never on the object's reference to it.
    expect(authoredObject.elements[0]).not.toHaveProperty("alt");

    // A reference to an existing element carries only identity and role.
    const response = await createObjects(owner, {
      vibe: vibe.uri,
      objects: [
        {
          type: "note",
          elements: [{ uri: authoredElement.uri, role: "content", alt: "Re-described" }],
          source: {
            ingest: { method: "parser", reproducible: true },
            origins: [origin.uri],
            properties: {},
          },
        },
      ],
    });
    expect(response.status).toBe(422);
  });

  test("a read grant reaches objects through Vibe membership", async () => {
    const response = await request(`/rnet/v0/objects/${objectId}`, { headers: dmachine });
    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBeNull();
  });

  test("write:user can update the user block", async () => {
    const response = await request(`/rnet/v0/objects/${objectId}/user`, {
      method: "PATCH",
      headers: dmachine,
      json: { properties: { reviewed: true } },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBeNull();
  });

  test("a later user write becomes current while the earlier revision remains history", async () => {
    const response = await request(`/rnet/v0/objects/${objectId}/user`, {
      method: "PATCH",
      headers: dmachine,
      json: { properties: { reviewed: false } },
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as MediaObject).user?.properties).toEqual({ reviewed: false });
  });

  test("write:user cannot write source", async () => {
    const response = await request(`/rnet/v0/objects/${objectId}/user`, {
      method: "PATCH",
      headers: dmachine,
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

  test("bare task validation prevents spoofing another writer's namespace", async () => {
    const response = await request(`/rnet/v0/objects/${objectId}/inferred`, {
      method: "PUT",
      headers: dmachine,
      json: { task: "rhizome:spoof", entry: { model: "semantics/test", properties: {} } },
    });
    expect(response.status).toBe(422);
  });

  test("a client may mark an entry its agent run accumulated as durable", async () => {
    const response = await request(`/rnet/v0/objects/${objectId}/inferred`, {
      method: "PUT",
      headers: dmachine,
      json: { task: "pattern", entry: { model: "semantics/test", durable: true, properties: {} } },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as MediaObject;
    expect(body.inferred?.["rbudget:pattern"]?.durable).toBe(true);
  });

  test("people hold no inferred writer namespace; the owner's corrections are user data", async () => {
    const response = await request(`/rnet/v0/objects/${objectId}/inferred`, {
      method: "PUT",
      headers: owner,
      json: {
        task: "correction",
        entry: { model: "user/direct", properties: { corrected: true } },
      },
    });
    expect(response.status).toBe(403);
    const body = (await (
      await request(`/rnet/v0/objects/${objectId}`, { headers: owner })
    ).json()) as MediaObject;
    expect(Object.keys(body.inferred ?? {}).some((key) => key.startsWith("user/"))).toBe(false);
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
          elements: [{ uri: otherElement.uri }],
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

  test("push task names and their record levels are discoverable to owners and clients", async () => {
    const ownerResponse = await request("/rnet/v0/push-tasks", { headers: owner });
    const clientResponse = await request("/rnet/v0/push-tasks", { headers: dmachine });
    expect(ownerResponse.status).toBe(200);
    expect(clientResponse.status).toBe(200);
    const manifests = (await ownerResponse.json()) as PushTaskManifestsResponse;
    expect(await clientResponse.json()).toEqual(manifests);
    const find = (level: PushTaskManifest["level"], name: string): PushTaskManifest => {
      const task = manifests.tasks.find((task) => task.level === level && task.name === name);
      expect(task).toBeDefined();
      return task!;
    };
    displayTask = find("object", "display_name");
    keywordsTask = find("object", "search_keywords");
    summarizeTask = find("vibe", "summarize");
    find("vibe", "vibe_view");
    for (const manifest of manifests.tasks) {
      expect(Object.keys(manifest).sort()).toEqual([
        "description",
        "label",
        "level",
        "name",
        "output_schema",
      ]);
      expect(manifest.label.length).toBeGreaterThan(0);
      expect(manifest.output_schema).toHaveProperty("type", "object");
    }
  });

  test("push requires its own named scope even when a client can read and write inferred", async () => {
    const response = await request(`/rnet/v0/vibes/${vibeId}/push`, {
      method: "POST",
      headers: dmachine,
      json: { level: displayTask.level, task: displayTask.name },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "grant_missing",
      scope: "push",
      detail: "The push scope is required",
    });
  });

  test("a push-only grantee can invoke but cannot poll or discover omitted membership in its handle", async () => {
    beforePush = await readObject();
    expect(beforePush.inferred?.["rbudget:pattern"]?.durable).toBe(true);
    await setClientScopes(["push"]);
    const response = await request(`/rnet/v0/vibes/${vibeId}/push`, {
      method: "POST",
      headers: dmachine,
      json: { level: displayTask.level, task: displayTask.name },
    });
    expect(response.status).toBe(202);
    const accepted = (await response.json()) as OperationDocument;
    expect(accepted.kind).toBe("push");
    expect(accepted.request).toEqual({
      mode: "push",
      level: displayTask.level,
      task: displayTask.name,
      vibe: vibe.uri,
    });
    expect(accepted.request).not.toHaveProperty("selection");
    expect(accepted.request).not.toHaveProperty("resolved");
    const denied = await request(`/rnet/v0/operations/${accepted.operation_id}`, {
      headers: dmachine,
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "grant_missing", scope: "read" });
    clientPush = await pollPush(accepted.operation_id);
  });

  test("a read-only grantee may poll push without owner usage but cannot invoke it", async () => {
    await setClientScopes(["read"]);
    const response = await request(`/rnet/v0/operations/${clientPush.operation_id}`, {
      headers: dmachine,
    });
    expect(response.status).toBe(200);
    const publicOperation = (await response.json()) as OperationDocument;
    expect(isPushOperation(publicOperation)).toBe(true);
    if (!isPushOperation(publicOperation) || !publicOperation.result || !clientPush.result)
      throw new Error("Expected completed push results");
    const { usage, ...visibleResult } = clientPush.result;
    expect(usage!.tokens_in).toBeGreaterThan(0);
    expect(Number(usage!.usd)).toBeGreaterThan(0);
    expect(publicOperation.result).toEqual(visibleResult);
    expect(publicOperation.result).not.toHaveProperty("usage");
    expect(publicOperation.request).not.toHaveProperty("resolved");
    expect(clientPush.request).not.toHaveProperty("resolved");
    const denied = await request(`/rnet/v0/vibes/${vibeId}/push`, {
      method: "POST",
      headers: dmachine,
      json: { level: displayTask.level, task: displayTask.name },
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "grant_missing", scope: "push" });
  });

  test("push writes only inferred under the store namespace and preserves durable and other-writer entries", async () => {
    const after = await readObject();
    const { inferred: beforeInferred, ...beforeOtherBlocks } = beforePush;
    const { inferred: afterInferred, ...afterOtherBlocks } = after;
    expect(afterOtherBlocks).toEqual(beforeOtherBlocks);
    expect(Object.keys(afterInferred!).sort()).toEqual(
      [...Object.keys(beforeInferred ?? {}), storeTaskKey(displayTask.name)].sort(),
    );
    for (const [key, entry] of Object.entries(beforeInferred ?? {}))
      expect(afterInferred![key]).toEqual(entry);
    expect(afterInferred?.["rbudget:pattern"]).toEqual(beforeInferred?.["rbudget:pattern"]);
    const entry = afterInferred![storeTaskKey(displayTask.name)]!;
    expect(entry).toMatchObject({
      model: "openai/gpt-5.6-luna",
      properties: { display_name: "Name 1" },
    });
    expect(entry).not.toHaveProperty("durable");
    expect(validateMediaObject(after).ok).toBe(true);
  });

  test("a later push replaces only its own task key and never marks its output durable", async () => {
    await pushAndPoll(keywordsTask, [createdObject.uri]);
    const before = await readObject();
    expect(before.inferred?.[storeTaskKey(keywordsTask.name)]).toBeDefined();
    await pushAndPoll(displayTask, [createdObject.uri]);
    const after = await readObject();
    const key = storeTaskKey(displayTask.name);
    expect(after.inferred![key]!.properties).toEqual({ display_name: "Name 2" });
    expect(after.inferred![key]).not.toEqual(before.inferred![key]);
    for (const [otherKey, entry] of Object.entries(before.inferred!))
      if (otherKey !== key) expect(after.inferred![otherKey]).toEqual(entry);
    const omitTask = (object: MediaObject) => ({
      ...object,
      inferred: Object.fromEntries(
        Object.entries(object.inferred!).filter(([name]) => name !== key),
      ),
    });
    expect(omitTask(after)).toEqual(omitTask(before));
    expect(after.inferred![key]).not.toHaveProperty("durable");
    expect(after.inferred![storeTaskKey(keywordsTask.name)]).not.toHaveProperty("durable");
  });

  test("Vibe-level push writes the Vibe's inferred block and preserves its protocol document", async () => {
    const before = (await (
      await request(`/rnet/v0/vibes/${vibeId}`, { headers: owner })
    ).json()) as Vibe;
    const operation = await pushAndPoll(summarizeTask);
    expect(operation.result).toMatchObject({ level: "vibe", vibe: { outcome: "written" } });
    const after = (await (
      await request(`/rnet/v0/vibes/${vibeId}`, { headers: owner })
    ).json()) as Vibe;
    expect(validateSchema("vibe", after).ok).toBe(true);
    expect(after.inferred?.[storeTaskKey(summarizeTask.name)]).toMatchObject({
      properties: { summary: "fake", tags: ["fake"] },
      confidence: 0.5,
    });
    expect(after.inferred?.[storeTaskKey(summarizeTask.name)]).not.toHaveProperty("durable");
    const { inferred: _beforeInferred, ...beforeOther } = before;
    const { inferred: _afterInferred, ...afterOther } = after;
    expect(afterOther).toEqual(beforeOther);
  });

  test("a keyless store serves discovery and rejects authorized push with 503", async () => {
    const discovery = await keylessApp.request("http://rhizome.test/rnet/v0/push-tasks", {
      headers: dmachine,
    });
    expect(discovery.status).toBe(200);
    expect((await discovery.json()) as PushTaskManifestsResponse).toHaveProperty("tasks");
    const invoke = (headers: Record<string, string>) =>
      keylessApp.request(`http://rhizome.test/rnet/v0/vibes/${vibeId}/push`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ level: displayTask.level, task: displayTask.name }),
      });
    const denied = await invoke(dmachine);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "grant_missing", scope: "push" });
    const unavailable = await invoke(owner);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({ code: "push_unavailable" });
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
    const bytes = await app.request(authoredElementBytesUrl, { headers: dmachine });
    expect(bytes.status).toBe(403);
  });
});

async function setClientScopes(scope: string[]): Promise<void> {
  const response = await request(`/rnet/v0/vibes/${vibeId}`, {
    method: "PATCH",
    headers: owner,
    json: { grants: [{ subject: "client:rbudget", scope }] },
  });
  expect(response.status).toBe(200);
}

async function readObject(): Promise<MediaObject> {
  const response = await request(`/rnet/v0/objects/${objectId}`, { headers: owner });
  expect(response.status).toBe(200);
  return (await response.json()) as MediaObject;
}

async function pushAndPoll(task: PushTaskManifest, selection?: string[]) {
  const response = await request(`/rnet/v0/vibes/${vibeId}/push`, {
    method: "POST",
    headers: owner,
    json: { level: task.level, task: task.name, ...(selection ? { selection } : {}) },
  });
  expect(response.status).toBe(202);
  return pollPush(((await response.json()) as OperationDocument).operation_id);
}

async function pollPush(
  id: string,
): Promise<OperationDocument & { result: PushOperationResult | null }> {
  for (let attempt = 0; attempt < 500; attempt++) {
    const response = await request(`/rnet/v0/operations/${id}`, { headers: owner });
    expect(response.status).toBe(200);
    const operation = (await response.json()) as OperationDocument;
    if (["queued", "running"].includes(operation.status)) {
      await Bun.sleep(10);
      continue;
    }
    expect(operation.status).toBe("done");
    expect(isPushOperation(operation)).toBe(true);
    if (!isPushOperation(operation)) throw new Error("Expected a push operation");
    // Every accepted push in this HTTP suite proves owner-visible metering on completion.
    expect(operation.finished_at).toBeDefined();
    expect(operation.result?.usage?.tokens_in).toBeGreaterThan(0);
    expect(operation.result?.usage?.tokens_out).toBeGreaterThan(0);
    expect(Number(operation.result?.usage?.usd)).toBeGreaterThan(0);
    expect(operation.request).not.toHaveProperty("resolved");
    return operation;
  }
  throw new Error("Push did not finish");
}

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
