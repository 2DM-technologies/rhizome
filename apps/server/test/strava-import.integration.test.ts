import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import S3rver from "s3rver";
import type { MediaObject } from "@rnet/types";
import type { OperationDocument } from "@rhizome/store-contract";
import { createApp } from "../src/app.ts";
import { createBlobStore } from "../src/blobs/index.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, createProviderLeasePool } from "../src/db/index.ts";
import { mediaObjects } from "../src/db/models/media-object.ts";
import { mediaObjectRevisions } from "../src/db/models/media-object-revision.ts";
import { seedDb } from "../src/db/seedDb.ts";
import { FakeModelConnector } from "../src/inference/fake-connector.ts";
import { createCredentialKeyring } from "../src/services/source-credential-crypto.ts";
import {
  activityCsv,
  representativeSyntheticExport,
  type SyntheticRow,
} from "../../ingest/skills/strava/fixtures/synthetic.ts";

const databaseUrl = process.env.RHIZOME_TEST_DATABASE_URL ?? "postgres://localhost/rhizome_m1_test";
const { db, client } = createDatabase(databaseUrl, { max: 6 });
const providerLeasePool = createProviderLeasePool(databaseUrl);
let scratch = "",
  s3: S3rver | undefined,
  config: ServerConfig;
let app: ReturnType<typeof createApp>["app"];

beforeAll(async () => {
  await client.unsafe("TRUNCATE TABLE users CASCADE");
  await seedDb(db);
  scratch = await mkdtemp(join(tmpdir(), "rhizome-strava-"));
  const buckets = {
    elements: "elements",
    origins: "origins",
    bundles: "bundles",
    assets: "assets",
  };
  s3 = new S3rver({
    address: "127.0.0.1",
    port: 0,
    silent: true,
    directory: join(scratch, "storage"),
    configureBuckets: Object.values(buckets).map((name) => ({ name, configs: [] })),
  });
  const address = await s3.run();
  config = {
    port: 3000,
    databaseUrl,
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
      endpoint: `http://${address.address}:${address.port}`,
      accessKeyId: "S3RVER",
      secretAccessKey: "S3RVER",
      forcePathStyle: true,
      buckets,
    },
  };
  app = createApp({ config, db, providerLeasePool, blobs: createBlobStore(config) }).app;
});
afterAll(async () => {
  await providerLeasePool.end();
  await client.end();
  await s3?.close();
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

function id(uri: string): string {
  return uri.split("/").at(-1)!;
}
function sourceId(source: string): string {
  return source.replace(/^source:/, "");
}
function api(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  token = "dev:user",
) {
  return app.request(`/rnet/v0${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function json(response: Response | Promise<Response>, status = 200) {
  const value = await response;
  const body = await value.json();
  expect({ status: value.status, ...(value.status === status ? {} : { body }) }).toEqual({
    status,
  });
  return body;
}
async function upload(bytes: Uint8Array, token = "dev:user", zip = false) {
  return json(
    app.request("/rnet/v0/origins", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": zip ? "application/zip" : "text/csv",
        "X-Rnet-Label": zip ? "synthetic-strava-export.zip" : "activities.csv",
      },
      body: Uint8Array.from(bytes).buffer,
    }),
    201,
  );
}
async function poll(initial: OperationDocument) {
  let operation = initial;
  for (let attempt = 0; attempt < 500; attempt++) {
    if (!["queued", "running"].includes(operation.status)) return operation;
    await Bun.sleep(10);
    operation = await json(api(`/operations/${operation.operation_id}`));
  }
  throw new Error(`Operation did not finish: ${operation.operation_id}`);
}
async function preview(vibe: string, source: string, replacementOrigin?: string) {
  return poll(
    await json(
      api(`/vibes/${vibe}/imports`, {
        source,
        ...(replacementOrigin ? { replacement_origin: replacementOrigin } : {}),
      }),
      202,
    ),
  );
}
async function confirm(vibe: string, operation: OperationDocument) {
  return json(api(`/vibes/${vibe}/imports/${operation.operation_id}/confirm`, undefined, "POST"));
}
async function getObject(uri: string): Promise<MediaObject> {
  return json(api(`/objects/${id(uri)}`));
}
async function countObjects(): Promise<number> {
  const [row] = await client.unsafe("select count(*)::int as count from media_objects");
  return row!.count;
}
async function fixture(rows: SyntheticRow[] = [{ id: "1" }, { id: "2" }, { id: "3" }]) {
  const vibe = await json(
    api("/vibes", {
      title: "Running history",
      grants: [{ subject: "client:rbudget", scope: ["read", "pull"] }],
    }),
    201,
  );
  const origin = await upload(activityCsv(rows));
  const source = await json(
    api("/ingestion-sources", { skill_id: "strava", origin: origin.uri }),
    201,
  );
  const operation = await preview(id(vibe.uri), source.source);
  expect(operation.status).toBe("done");
  const confirmed = await confirm(id(vibe.uri), operation);
  const objects = await Promise.all(confirmed.objects.map((uri: string) => getObject(uri)));
  return {
    vibe: id(vibe.uri),
    origin,
    source: source.source as string,
    objects: objects as MediaObject[],
  };
}
function result(operation: OperationDocument) {
  return operation.result as {
    candidates: MediaObject[];
    verify: { ok: boolean };
    reconciliation: {
      counts: { unchanged: number; added: number; changed: number; absent: number };
      baseline: Array<{ object_uri: string; positions: number[] }>;
      changes: Array<{
        previous_object_uri: string;
        next_object_uri: string;
        user_annotations?: Record<string, unknown>;
      }>;
    };
  };
}

describe("Strava owner-reviewed store import", () => {
  test("archive preview is isolated, origin remains owner-only, confirmation grounds facts and raw archive never enters model context", async () => {
    const fake = new FakeModelConnector();
    const ordinary = app;
    app = createApp({
      config,
      db,
      providerLeasePool,
      blobs: createBlobStore(config),
      modelConnectors: {
        identity: "openai/gpt-5.6-luna",
        target: { provider: "openai", name: "gpt-5.6-luna" },
        connector: fake,
      },
    }).app;
    try {
      const vibe = await json(
          api("/vibes", {
            title: "Marathon training",
            grants: [{ subject: "client:rbudget", scope: ["read", "pull"] }],
          }),
          201,
        ),
        vibeId = id(vibe.uri);
      const bytes = await representativeSyntheticExport(),
        origin = await upload(bytes, "dev:user", true);
      expect(
        (await api(`/origins/${id(origin.uri)}`, undefined, "GET", "dev:user:other")).status,
      ).toBe(403);
      expect(
        (await api(`/origins/${id(origin.uri)}`, undefined, "GET", "dev:client:rbudget")).status,
      ).toBe(403);
      const source = await json(
        api("/ingestion-sources", { skill_id: "strava", origin: origin.uri }),
        201,
      );
      expect(
        (
          await api(
            `/ingestion-sources/${sourceId(source.source)}`,
            undefined,
            "GET",
            "dev:user:other",
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await api(
            `/ingestion-sources/${sourceId(source.source)}`,
            undefined,
            "GET",
            "dev:client:rbudget",
          )
        ).status,
      ).toBe(403);
      const before = await countObjects(),
        staged = await preview(vibeId, source.source);
      expect(staged.status).toBe("done");
      expect(result(staged).verify.ok).toBe(true);
      expect(result(staged).candidates).toHaveLength(5);
      expect(await countObjects()).toBe(before);
      expect((await json(api(`/vibes/${vibeId}`))).objects).toEqual([]);
      expect(fake.requests).toHaveLength(0);
      // Dismissing this first review makes no writes; a fresh review can subsequently commit.
      const next = await preview(vibeId, source.source),
        committed = await confirm(vibeId, next);
      expect(committed.objects).toHaveLength(5);
      expect(await countObjects()).toBe(before + 5);
      const first = await getObject(committed.objects[0]);
      expect(first).toMatchObject({
        type: "fitness_activity",
        elements: [],
        keys: { strava_activity_id: "9007199254740993123" },
        source: {
          origins: [origin.uri],
          ingest: { method: "parser", reproducible: true },
          properties: { sport: "run", distance_m: 4023.36 },
        },
      });
      expect(first.source.properties.splits).toHaveLength(3);
      expect(first.source.properties).not.toHaveProperty("samples");
      const bytesResponse = await app.request(origin.bytes, {
        headers: { Authorization: "Bearer dev:user" },
      });
      expect(new Uint8Array(await bytesResponse.arrayBuffer())).toEqual(Uint8Array.from(bytes));
      for (let attempt = 0; attempt < 500; attempt++) {
        const active = await client.unsafe(
          "select count(*)::int as count from operations where vibe_uuid = $1 and status in ('queued','running')",
          [vibeId],
        );
        if (!active[0]!.count && fake.requests.length) break;
        await Bun.sleep(10);
      }
      expect(fake.requests.length).toBeGreaterThan(0);
      const context = JSON.stringify(fake.requests);
      expect(context).toContain("fitness_activity");
      expect(context).not.toContain("unconsumed private export content");
      expect(context).not.toContain("photos/unread.txt");
      expect(context).not.toContain("<Trackpoint>");
      expect(context).not.toContain("<trkpt");
    } finally {
      app = ordinary;
    }
  }, 20_000);

  test("new exports reconcile unchanged/new/changed/absent runs, preserve annotations and duplicate positions, and retain immutable history", async () => {
    const initial = await fixture(),
      [unchanged, changed, absent] = initial.objects;
    const user = { notes: "Official chip result from my race", official_chip_time_s: 1198 };
    await json(api(`/objects/${id(changed!.uri)}/user`, { properties: user }, "PATCH"));
    await json(
      api(
        `/objects/${id(unchanged!.uri)}/user`,
        { properties: { notes: "Keep this run" } },
        "PATCH",
      ),
    );
    const priorInference = {
      "rhizome:display_name": {
        model: "model:openai/gpt-5.6-luna",
        inferred_at: "2026-09-01T00:00:00Z",
        properties: { display_name: "Previous model name" },
      },
    };
    await db
      .update(mediaObjects)
      .set({ inferred: priorInference })
      .where(eq(mediaObjects.uuid, id(changed!.uri)));
    await db
      .update(mediaObjects)
      .set({ inferred: priorInference })
      .where(eq(mediaObjects.uuid, id(unchanged!.uri)));
    const duplicate = await api(`/vibes/${initial.vibe}/objects`, { objects: [changed!.uri] });
    expect(duplicate.status).toBe(204);
    const otherVibe = await json(api("/vibes", { title: "Race memories" }), 201);
    expect(
      (await api(`/vibes/${id(otherVibe.uri)}/objects`, { objects: [changed!.uri] })).status,
    ).toBe(204);
    const newer = await upload(
      activityCsv([{ id: "1" }, { id: "2", distance: "3300" }, { id: "4", title: "New run" }]),
    );
    const canceled = await preview(initial.vibe, initial.source, newer.uri);
    expect(canceled.status).toBe("done");
    expect(result(canceled).reconciliation.counts).toEqual({
      unchanged: 1,
      changed: 1,
      added: 1,
      absent: 1,
    });
    expect(result(canceled).reconciliation.changes[0]!.user_annotations).toEqual(user);
    expect(
      result(canceled).reconciliation.baseline.find(
        (binding) => binding.object_uri === changed!.uri,
      )!.positions,
    ).toEqual([1, 3]);
    expect((await json(api(`/ingestion-sources/${sourceId(initial.source)}`))).origin).toBe(
      initial.origin.uri,
    );
    expect((await json(api(`/vibes/${initial.vibe}`))).objects).toEqual([
      unchanged!.uri,
      changed!.uri,
      absent!.uri,
      changed!.uri,
    ]);
    const previewed = await preview(initial.vibe, initial.source, newer.uri),
      count = await countObjects();
    const accepted = await confirm(initial.vibe, previewed),
      replacement = result(previewed).reconciliation.changes[0]!.next_object_uri;
    expect(accepted.objects).toHaveLength(5);
    expect(accepted.objects.slice(0, 4)).toEqual([
      unchanged!.uri,
      replacement,
      absent!.uri,
      replacement,
    ]);
    expect(await countObjects()).toBe(count + 2);
    const next = await getObject(replacement);
    expect(next.user?.properties).toEqual(user);
    expect(next.source.origins).toEqual([newer.uri]);
    expect(next.source.properties.distance_m).toBe(3300);
    expect(next.inferred ?? {}).toEqual({});
    const old = await getObject(changed!.uri);
    expect(old.source).toEqual(changed!.source);
    expect(old.user?.properties).toEqual(user);
    expect(old.inferred).toEqual(priorInference);
    expect((await getObject(unchanged!.uri)).inferred).toEqual(priorInference);
    expect((await getObject(unchanged!.uri)).user?.properties).toEqual({ notes: "Keep this run" });
    expect((await json(api(`/vibes/${id(otherVibe.uri)}`))).objects).toEqual([changed!.uri]);
    expect((await json(api(`/ingestion-sources/${sourceId(initial.source)}`))).origin).toBe(
      newer.uri,
    );
    const revisions = await db
      .select()
      .from(mediaObjectRevisions)
      .where(
        and(
          eq(mediaObjectRevisions.mediaObjectUuid, id(replacement)),
          eq(mediaObjectRevisions.block, "user"),
        ),
      );
    expect(revisions).toHaveLength(1);
    expect(revisions[0]!.snapshot).toMatchObject({ properties: user });
    const replay = await poll(await json(api(`/vibes/${initial.vibe}/pull`, {}), 202));
    expect(replay.status).toBe("done");
    expect(replay.result).toMatchObject({ duplicate_count: 3, created_count: 0, added_count: 0 });
    expect(await countObjects()).toBe(count + 2);
    expect(
      (
        await api(
          `/vibes/${initial.vibe}/imports/${previewed.operation_id}/confirm`,
          undefined,
          "POST",
        )
      ).status,
    ).toBe(422);
  });

  test("post-preview annotation and membership edits each invalidate confirmation without rebinding the source", async () => {
    const initial = await fixture([{ id: "1" }]),
      original = initial.objects[0]!;
    const newer = await upload(activityCsv([{ id: "1", distance: "3500" }]));
    const annotationPreview = await preview(initial.vibe, initial.source, newer.uri);
    expect(annotationPreview.status).toBe("done");
    await json(
      api(
        `/objects/${id(original.uri)}/user`,
        { properties: { notes: "Edited while reviewing" } },
        "PATCH",
      ),
    );
    expect(
      (
        await api(
          `/vibes/${initial.vibe}/imports/${annotationPreview.operation_id}/confirm`,
          undefined,
          "POST",
        )
      ).status,
    ).toBe(422);
    expect((await json(api(`/ingestion-sources/${sourceId(initial.source)}`))).origin).toBe(
      initial.origin.uri,
    );
    const membershipPreview = await preview(initial.vibe, initial.source, newer.uri);
    expect((await api(`/vibes/${initial.vibe}/objects`, { objects: [original.uri] })).status).toBe(
      204,
    );
    expect(
      (
        await api(
          `/vibes/${initial.vibe}/imports/${membershipPreview.operation_id}/confirm`,
          undefined,
          "POST",
        )
      ).status,
    ).toBe(422);
    expect((await json(api(`/vibes/${initial.vibe}`))).objects).toEqual([
      original.uri,
      original.uri,
    ]);
    expect((await getObject(original.uri)).user?.properties).toEqual({
      notes: "Edited while reviewing",
    });
  });

  test("updating an intentionally detached run does not silently reattach it", async () => {
    const initial = await fixture([{ id: "1" }, { id: "2" }]);
    expect(
      (
        await api(
          `/vibes/${initial.vibe}/objects`,
          { objects: [initial.objects[0]!.uri] },
          "DELETE",
        )
      ).status,
    ).toBe(204);
    const newer = await upload(activityCsv([{ id: "1", distance: "3500" }, { id: "2" }]));
    const updated = await preview(initial.vibe, initial.source, newer.uri);
    expect(updated.status).toBe("done");
    const accepted = await confirm(initial.vibe, updated);
    expect(accepted.objects).toEqual([initial.objects[1]!.uri]);
    expect(
      (await getObject(result(updated).reconciliation.changes[0]!.next_object_uri)).source
        .properties.distance_m,
    ).toBe(3500);
  });

  test("shared source bindings, foreign origins, and parser failures cannot replace a configured snapshot", async () => {
    const initial = await fixture([{ id: "1" }]);
    const invalid = await upload(new TextEncoder().encode("arbitrary,csv\nwrong,shape"));
    const failed = await preview(initial.vibe, initial.source, invalid.uri);
    expect(failed.status).toBe("failed");
    expect(
      (
        await api(
          `/vibes/${initial.vibe}/imports/${failed.operation_id}/confirm`,
          undefined,
          "POST",
        )
      ).status,
    ).toBe(422);
    expect((await json(api(`/ingestion-sources/${sourceId(initial.source)}`))).origin).toBe(
      initial.origin.uri,
    );
    const foreign = await upload(activityCsv([{ id: "1" }]), "dev:user:other");
    expect(
      (
        await api(`/vibes/${initial.vibe}/imports`, {
          source: initial.source,
          replacement_origin: foreign.uri,
        })
      ).status,
    ).toBe(422);
    const second = await json(api("/vibes", { title: "Shared source" }), 201);
    const sharedPreview = await preview(id(second.uri), initial.source);
    const shared = await confirm(id(second.uri), sharedPreview);
    expect(shared.pull.sources).toContain(initial.source);
    const newer = await upload(activityCsv([{ id: "1", distance: "3500" }]));
    expect(
      (
        await api(`/vibes/${initial.vibe}/imports`, {
          source: initial.source,
          replacement_origin: newer.uri,
        })
      ).status,
    ).toBe(422);
    expect((await json(api(`/ingestion-sources/${sourceId(initial.source)}`))).origin).toBe(
      initial.origin.uri,
    );
  });
});
