import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { MediaObject } from "@rnet/types";
import type { OperationDocument } from "@rhizome/store-contract";
import { and, asc, eq } from "drizzle-orm";
import S3rver from "s3rver";

import { createApp } from "../src/app.ts";
import { createBlobStore } from "../src/blobs/index.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase } from "../src/db/index.ts";
import { mediaObjectRevisions } from "../src/db/models/media-object-revision.ts";
import { seedDb } from "../src/db/seedDb.ts";

const databaseUrl = process.env.RHIZOME_TEST_DATABASE_URL ?? "postgres://localhost/rhizome_m1_test";
const { db, client } = createDatabase(databaseUrl, { max: 4 });
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
const otherOwner = { Authorization: "Bearer dev:user:other" };
const dmachine = { Authorization: "Bearer dev:client:rbudget" };

beforeAll(async () => {
  await client.unsafe(`
    TRUNCATE TABLE
      meter_entry, media_object_revisions, vibe_revisions, media_object_origins, media_object_elements,
      vibe_media_objects, grants, operations, ingestion_source_objects, ingestion_sources,
      media_objects, media_elements, origins, vibes, dmachines, users
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
  await seedDb(db);
});

afterAll(async () => {
  await s3?.close();
  await client.end();
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

describe("rNet M1 store", () => {
  let vibeId = "";
  let mediaObjectId = "";
  let repeatableMediaObjectUri = "";
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

    const invalidUploadKind = await app.request("http://rhizome.test/rnet/v0/elements", {
      method: "POST",
      headers: { ...owner, "Content-Type": "text/plain", "X-Rnet-Kind": "executable" },
      body: "echo nope",
    });
    expect(invalidUploadKind.status).toBe(422);

    const missingUploadKind = await app.request("http://rhizome.test/rnet/v0/elements", {
      method: "POST",
      headers: { ...owner, "Content-Type": "text/plain" },
      body: "missing kind",
    });
    expect(missingUploadKind.status).toBe(422);
  });

  test("creates a Vibe with a real dMachine grant", async () => {
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

  test("lists Vibes granted to a user alongside their owned Vibes", async () => {
    const created = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: {
        title: "Shared with another user",
        grants: [
          {
            subject: "id:rnet://id/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b49",
            scope: ["read"],
          },
        ],
      },
    });
    expect(created.status).toBe(201);
    const shared = await created.json();

    const owned = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: otherOwner,
      json: { title: "Owned by the granted user" },
    });
    expect(owned.status).toBe(201);
    const ownedVibe = await owned.json();

    const response = await request("/rnet/v0/vibes", { headers: otherOwner });
    expect(response.status).toBe(200);
    const collection = await response.json();
    const uris = collection.vibes.map((vibe: { uri: string }) => vibe.uri);
    expect(uris).toContain(shared.uri);
    expect(uris).toContain(ownedVibe.uri);
  });

  test("rejects grant subjects the store cannot resolve", async () => {
    const response = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: { title: "Bad grant", grants: [{ subject: "x-ghost:anyone", scope: ["read"] }] },
    });
    expect(response.status).toBe(422);
  });

  test("rejects non-UUIDv7 user grant subjects at the route boundary", async () => {
    const response = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: {
        title: "Bad user grant",
        grants: [{ subject: "id:rnet://id/alice", scope: ["read"] }],
      },
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

  test("stages, verifies, and atomically confirms supported CSV and QFX imports", async () => {
    const vibeResponse = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: {
        title: "Reviewed imports",
        grants: [{ subject: "client:rbudget", scope: ["pull"] }],
      },
    });
    expect(vibeResponse.status).toBe(201);
    const importVibe = await vibeResponse.json();
    const importVibeId = importVibe.uri.split("/").at(-1);

    const csvBytes = await Bun.file(
      new URL("../../ingest/skills/csv/fixtures/rhizome-bank.csv", import.meta.url),
    ).text();
    const csvOriginResponse = await app.request("http://rhizome.test/rnet/v0/origins", {
      method: "POST",
      headers: { ...owner, "Content-Type": "text/csv", "X-Rnet-Label": "rhizome-bank.csv" },
      body: csvBytes,
    });
    expect(csvOriginResponse.status).toBe(201);
    const csvOrigin = await csvOriginResponse.json();

    expect(
      (
        await request("/rnet/v0/ingestion-sources", {
          method: "POST",
          headers: otherOwner,
          json: { origin: csvOrigin.uri, parser: "csv" },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request("/rnet/v0/ingestion-sources", {
          method: "POST",
          headers: dmachine,
          json: { origin: csvOrigin.uri, parser: "csv" },
        })
      ).status,
    ).toBe(403);

    const csvSourceResponse = await request("/rnet/v0/ingestion-sources", {
      method: "POST",
      headers: owner,
      json: { origin: csvOrigin.uri, parser: "csv" },
    });
    expect(csvSourceResponse.status).toBe(201);
    const csvSource = await csvSourceResponse.json();
    expect(csvSource).toMatchObject({
      kind: "origin",
      parser: "csv",
      parser_version: "csv@1.1.0",
      origin: csvOrigin.uri,
    });

    const [beforeCsv] = await client.unsafe("select count(*)::int as count from media_objects");
    const csvPreviewResponse = await request(`/rnet/v0/vibes/${importVibeId}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: csvSource.source },
    });
    expect(csvPreviewResponse.status).toBe(202);
    const csvPreview = await waitForOperation(await csvPreviewResponse.json(), owner);
    expect(csvPreview.status).toBe("done");
    expect(csvPreview.result).toMatchObject({
      verify: {
        ok: true,
        source_record_count: 3,
        candidate_count: 3,
        totals_by_currency: { USD: "2410.25" },
      },
    });
    expect((csvPreview.result as { candidates: unknown[] }).candidates).toHaveLength(3);
    expect(
      (csvPreview.result as { candidates: Array<{ source: { ingest: { skill?: string } } }> })
        .candidates[0]?.source.ingest.skill,
    ).toBe("csv@1.1.0");
    const [afterPreview] = await client.unsafe("select count(*)::int as count from media_objects");
    expect(afterPreview?.count).toBe(beforeCsv?.count);

    const confirmedCsv = await request(
      `/rnet/v0/vibes/${importVibeId}/imports/${csvPreview.operation_id}/confirm`,
      { method: "POST", headers: owner },
    );
    expect(confirmedCsv.status).toBe(200);
    const csvVibe = await confirmedCsv.json();
    expect(csvVibe.objects).toHaveLength(3);
    expect(csvVibe.pull.sources).toContain(csvSource.source);
    const [afterConfirm] = await client.unsafe("select count(*)::int as count from media_objects");
    expect(afterConfirm?.count).toBe((beforeCsv?.count ?? 0) + 3);
    expect(
      (
        await request(`/rnet/v0/vibes/${importVibeId}/imports/${csvPreview.operation_id}/confirm`, {
          method: "POST",
          headers: owner,
        })
      ).status,
    ).toBe(422);
    expect(await mediaObjectCount()).toBe(afterConfirm?.count);

    const canceledPreviewResponse = await request(`/rnet/v0/vibes/${importVibeId}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: csvSource.source },
    });
    const canceledPreview = await waitForOperation(await canceledPreviewResponse.json(), owner);
    expect(canceledPreview.status).toBe("done");
    const [afterCancel] = await client.unsafe("select count(*)::int as count from media_objects");
    expect(afterCancel?.count).toBe(afterConfirm?.count);

    const qfxBytes = await Bun.file(
      new URL("../../ingest/skills/ofx/fixtures/checking.qfx", import.meta.url),
    ).text();
    const qfxOriginResponse = await app.request("http://rhizome.test/rnet/v0/origins", {
      method: "POST",
      headers: {
        ...owner,
        "Content-Type": "application/x-ofx",
        "X-Rnet-Label": "checking.qfx",
      },
      body: qfxBytes,
    });
    const qfxOrigin = await qfxOriginResponse.json();
    const qfxSourceResponse = await request("/rnet/v0/ingestion-sources", {
      method: "POST",
      headers: owner,
      json: { origin: qfxOrigin.uri, parser: "ofx" },
    });
    const qfxSource = await qfxSourceResponse.json();
    const qfxPreviewResponse = await request(`/rnet/v0/vibes/${importVibeId}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: qfxSource.source },
    });
    const qfxPreview = await waitForOperation(await qfxPreviewResponse.json(), owner);
    expect(qfxPreview.result).toMatchObject({
      verify: { ok: true, candidate_count: 2, totals_by_currency: { USD: "2493.50" } },
    });
    const confirmedQfx = await request(
      `/rnet/v0/vibes/${importVibeId}/imports/${qfxPreview.operation_id}/confirm`,
      { method: "POST", headers: owner },
    );
    expect(confirmedQfx.status).toBe(200);
    expect((await confirmedQfx.json()).objects).toHaveLength(5);

    const [beforePull] = await client.unsafe("select count(*)::int as count from media_objects");
    const dryRunResponse = await request(`/rnet/v0/vibes/${importVibeId}/pull`, {
      method: "POST",
      headers: owner,
      json: { dry_run: true },
    });
    expect(dryRunResponse.status).toBe(202);
    const dryRun = await waitForOperation(await dryRunResponse.json(), owner);
    expect(dryRun.status).toBe("done");
    expect(dryRun.committed_at).toBeUndefined();
    expect(dryRun.result).toMatchObject({
      dry_run: true,
      policy: "append_new",
      candidate_count: 5,
      duplicate_count: 5,
      added_count: 0,
      created_count: 0,
      removed_count: 0,
    });
    expect(
      (await client.unsafe("select count(*)::int as count from media_objects"))[0]?.count,
    ).toBe(beforePull?.count);

    const delegatedPullResponse = await request(`/rnet/v0/vibes/${importVibeId}/pull`, {
      method: "POST",
      headers: dmachine,
      json: {},
    });
    expect(delegatedPullResponse.status).toBe(202);
    const delegatedPull = await waitForOperation(await delegatedPullResponse.json(), dmachine);
    expect(delegatedPull.status).toBe("done");
    expect(delegatedPull.committed_at).toBeString();
    expect(delegatedPull.result).toMatchObject({
      dry_run: false,
      policy: "append_new",
      candidate_count: 5,
      duplicate_count: 5,
      added_count: 0,
      created_count: 0,
    });
    expect(
      (await client.unsafe("select count(*)::int as count from media_objects"))[0]?.count,
    ).toBe(beforePull?.count);
    expect(
      (
        await request(`/rnet/v0/vibes/${importVibeId}/pull`, {
          method: "POST",
          headers: otherOwner,
          json: {},
        })
      ).status,
    ).toBe(403);

    const suggestOnlyVibeResponse = await request(`/rnet/v0/vibes/${importVibeId}`, {
      method: "PATCH",
      headers: owner,
      json: {
        pull: {
          enabled: true,
          sources: [csvSource.source, qfxSource.source],
          policy: "suggest_only",
        },
      },
    });
    expect(suggestOnlyVibeResponse.status).toBe(200);
    const suggestOnlyResponse = await request(`/rnet/v0/vibes/${importVibeId}/pull`, {
      method: "POST",
      headers: owner,
      json: {},
    });
    const suggestOnly = await waitForOperation(await suggestOnlyResponse.json(), owner);
    expect(suggestOnly.committed_at).toBeUndefined();
    expect(suggestOnly.result).toMatchObject({
      policy: "suggest_only",
      candidate_count: 5,
      duplicate_count: 5,
      added_count: 0,
      created_count: 0,
    });

    const replaceVibeResponse = await request(`/rnet/v0/vibes/${importVibeId}`, {
      method: "PATCH",
      headers: owner,
      json: {
        pull: {
          enabled: true,
          sources: [csvSource.source, qfxSource.source],
          policy: "replace",
        },
      },
    });
    expect(replaceVibeResponse.status).toBe(200);
    const replaceResponse = await request(`/rnet/v0/vibes/${importVibeId}/pull`, {
      method: "POST",
      headers: owner,
      json: {},
    });
    const replace = await waitForOperation(await replaceResponse.json(), owner);
    expect(replace.result).toMatchObject({
      policy: "replace",
      candidate_count: 5,
      duplicate_count: 5,
      added_count: 5,
      created_count: 0,
      removed_count: 5,
    });
    const replacedVibe = await request(`/rnet/v0/vibes/${importVibeId}`, { headers: owner });
    expect((await replacedVibe.json()).objects).toHaveLength(5);
    expect(
      (await client.unsafe("select count(*)::int as count from media_objects"))[0]?.count,
    ).toBe(beforePull?.count);
    expect(
      (await request(`/rnet/v0/origins/${csvOrigin.uri.split("/").at(-1)}`, { headers: owner }))
        .status,
    ).toBe(200);

    const removeSourceResponse = await request(`/rnet/v0/vibes/${importVibeId}`, {
      method: "PATCH",
      headers: owner,
      json: {
        pull: {
          enabled: false,
          sources: [csvSource.source],
          policy: "append_new",
        },
      },
    });
    expect(removeSourceResponse.status).toBe(200);
    expect((await removeSourceResponse.json()).pull).toMatchObject({
      enabled: false,
      sources: [csvSource.source],
      policy: "append_new",
    });
  });

  test("only reviewed confirmation can introduce a source and cancellation leaves no derived state", async () => {
    const fixture = await createCsvSourceFixture("cancel-review.csv");
    const [beforeObjects] = await client.unsafe("select count(*)::int as count from media_objects");

    const createBypass = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: {
        title: "Unreviewed source on create",
        pull: {
          enabled: true,
          sources: [fixture.source.source],
          policy: "append_new",
        },
      },
    });
    expect(createBypass.status).toBe(422);
    expect((await createBypass.json()).code).toBe("import_review_invalid");

    const vibeResponse = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: { title: "Canceled import" },
    });
    expect(vibeResponse.status).toBe(201);
    const vibe = await vibeResponse.json();
    const vibeId = vibe.uri.split("/").at(-1);

    const patchBypass = await request(`/rnet/v0/vibes/${vibeId}`, {
      method: "PATCH",
      headers: owner,
      json: {
        pull: {
          enabled: true,
          sources: [fixture.source.source],
          policy: "append_new",
        },
      },
    });
    expect(patchBypass.status).toBe(422);
    expect((await patchBypass.json()).code).toBe("import_review_invalid");
    expect(
      (
        await request(`/rnet/v0/vibes/${vibeId}/pull`, {
          method: "POST",
          headers: owner,
          json: {},
        })
      ).status,
    ).toBe(422);

    const previewResponse = await request(`/rnet/v0/vibes/${vibeId}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: fixture.source.source },
    });
    expect(previewResponse.status).toBe(202);
    const preview = await waitForOperation(await previewResponse.json(), owner);
    expect(preview.status).toBe("done");
    expect(preview.committed_at).toBeUndefined();

    // Leaving the completed review unconfirmed is the cancellation boundary. The owner-only
    // origin and source remain for audit/retry, while all derived state stays untouched.
    const afterCancel = await request(`/rnet/v0/vibes/${vibeId}`, { headers: owner });
    const canceledVibe = await afterCancel.json();
    expect(canceledVibe.objects).toEqual([]);
    expect(canceledVibe.pull?.sources ?? []).toEqual([]);
    expect(await mediaObjectCount()).toBe(beforeObjects?.count);
    expect(await sourceBindingCount(fixture.source.source)).toBe(0);
    expect(
      (
        await request(`/rnet/v0/origins/${fixture.origin.uri.split("/").at(-1)}`, {
          headers: owner,
        })
      ).status,
    ).toBe(200);
    const [retainedSource] = await client.unsafe(
      "select count(*)::int as count from ingestion_sources where uuid = $1 and revoked_at is null",
      [sourceUuid(fixture.source.source)],
    );
    expect(retainedSource?.count).toBe(1);
  });

  test("wrong-Vibe and tampered reviews fail without consuming or partially committing", async () => {
    const fixture = await createCsvSourceFixture("tampered-review.csv");
    const targetResponse = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: { title: "Digest target" },
    });
    const wrongVibeResponse = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: { title: "Wrong digest target" },
    });
    const target = await targetResponse.json();
    const wrongVibe = await wrongVibeResponse.json();
    const targetId = target.uri.split("/").at(-1);
    const wrongVibeId = wrongVibe.uri.split("/").at(-1);
    const beforeObjects = await mediaObjectCount();

    const previewResponse = await request(`/rnet/v0/vibes/${targetId}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: fixture.source.source },
    });
    const preview = await waitForOperation(await previewResponse.json(), owner);
    expect(preview.status).toBe("done");

    const wrongConfirm = await request(
      `/rnet/v0/vibes/${wrongVibeId}/imports/${preview.operation_id}/confirm`,
      { method: "POST", headers: owner },
    );
    expect(wrongConfirm.status).toBe(422);
    expect((await wrongConfirm.json()).code).toBe("import_review_invalid");

    await client.unsafe(
      `update operations
       set result = jsonb_set(
         result,
         '{candidates,0,source,properties,amount}',
         to_jsonb('999.99'::text)
       )
       where uuid = $1`,
      [preview.operation_id],
    );
    const tamperedConfirm = await request(
      `/rnet/v0/vibes/${targetId}/imports/${preview.operation_id}/confirm`,
      { method: "POST", headers: owner },
    );
    expect(tamperedConfirm.status).toBe(422);
    expect((await tamperedConfirm.json()).code).toBe("import_review_invalid");
    expect(await mediaObjectCount()).toBe(beforeObjects);
    expect(await sourceBindingCount(fixture.source.source)).toBe(0);
    const unchangedTarget = await request(`/rnet/v0/vibes/${targetId}`, { headers: owner });
    const targetVibe = await unchangedTarget.json();
    expect(targetVibe.objects).toEqual([]);
    expect(targetVibe.pull?.sources ?? []).toEqual([]);
    const operationAfterFailures = await request(`/rnet/v0/operations/${preview.operation_id}`, {
      headers: owner,
    });
    expect((await operationAfterFailures.json()).committed_at).toBeUndefined();
  });

  test("tombstoning an origin after preview makes the review stale without writes", async () => {
    const fixture = await createCsvSourceFixture("tombstoned-review.csv");
    const vibeResponse = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: { title: "Tombstoned origin review" },
    });
    const vibe = await vibeResponse.json();
    const vibeId = vibe.uri.split("/").at(-1);
    const beforeObjects = await mediaObjectCount();
    const previewResponse = await request(`/rnet/v0/vibes/${vibeId}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: fixture.source.source },
    });
    const preview = await waitForOperation(await previewResponse.json(), owner);
    expect(preview.status).toBe("done");

    const originId = fixture.origin.uri.split("/").at(-1);
    expect(
      (await request(`/rnet/v0/origins/${originId}`, { method: "DELETE", headers: owner })).status,
    ).toBe(204);
    const confirm = await request(
      `/rnet/v0/vibes/${vibeId}/imports/${preview.operation_id}/confirm`,
      { method: "POST", headers: owner },
    );
    expect(confirm.status).toBe(404);
    expect(await mediaObjectCount()).toBe(beforeObjects);
    expect(await sourceBindingCount(fixture.source.source)).toBe(0);
    const unchangedVibe = await request(`/rnet/v0/vibes/${vibeId}`, { headers: owner });
    const document = await unchangedVibe.json();
    expect(document.objects).toEqual([]);
    expect(document.pull?.sources ?? []).toEqual([]);
  });

  test("rejects provenance mismatches and malformed extensions before persistence", async () => {
    const [before] = await client.unsafe("select count(*)::int as count from media_objects");
    const authoredFromArtifact = await request("/rnet/v0/objects", {
      method: "POST",
      headers: owner,
      json: {
        objects: [
          {
            type: "note",
            source: {
              ingest: { method: "authored", reproducible: false },
              origins: [originUri],
              properties: {},
            },
          },
        ],
      },
    });
    expect(authoredFromArtifact.status).toBe(422);

    const parsedFromClient = await request("/rnet/v0/objects", {
      method: "POST",
      headers: owner,
      json: {
        objects: [
          {
            type: "note",
            source: {
              ingest: { method: "parser", reproducible: true },
              origins: ["rnet://client/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b48"],
              properties: {},
            },
          },
        ],
      },
    });
    expect(parsedFromClient.status).toBe(422);

    const malformedExtension = await request("/rnet/v0/objects", {
      method: "POST",
      headers: owner,
      json: {
        objects: [
          {
            type: "note",
            source: {
              ingest: { method: "parser", reproducible: true },
              origins: [originUri],
              properties: {},
            },
            "x-": true,
          },
        ],
      },
    });
    expect(malformedExtension.status).toBe(422);
    const [after] = await client.unsafe("select count(*)::int as count from media_objects");
    expect(after?.count).toBe(before?.count);
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

  test("rejects malformed task names before persistence", async () => {
    const response = await request(`/rnet/v0/objects/${mediaObjectId}/inferred`, {
      method: "PUT",
      headers: owner,
      json: { task: "bad task", entry: { model: "test/model", properties: {} } },
    });
    expect(response.status).toBe(422);
    const mediaObject = await (
      await request(`/rnet/v0/objects/${mediaObjectId}`, { headers: owner })
    ).json();
    expect(mediaObject.inferred?.["user/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47:bad task"]).toBe(
      undefined,
    );
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
    repeatableMediaObjectUri = uris[0]!;
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

  test("allows repeated placements and delete-by-URI removes every occurrence", async () => {
    const add = await request(`/rnet/v0/vibes/${vibeId}/objects`, {
      method: "POST",
      headers: owner,
      json: { objects: [repeatableMediaObjectUri, repeatableMediaObjectUri] },
    });
    expect(add.status).toBe(204);

    const listedAfterAdd = await (
      await request(`/rnet/v0/vibes/${vibeId}/objects`, { headers: owner })
    ).json();
    expect(
      listedAfterAdd.mediaObjects
        .map((item: { uri: string }) => item.uri)
        .filter((uri: string) => uri === repeatableMediaObjectUri),
    ).toEqual([repeatableMediaObjectUri, repeatableMediaObjectUri, repeatableMediaObjectUri]);
    const vibeAfterAdd = await (
      await request(`/rnet/v0/vibes/${vibeId}`, { headers: owner })
    ).json();
    expect(vibeAfterAdd.objects.filter((uri: string) => uri === repeatableMediaObjectUri)).toEqual([
      repeatableMediaObjectUri,
      repeatableMediaObjectUri,
      repeatableMediaObjectUri,
    ]);

    const remove = await request(`/rnet/v0/vibes/${vibeId}/objects`, {
      method: "DELETE",
      headers: owner,
      json: { objects: [repeatableMediaObjectUri] },
    });
    expect(remove.status).toBe(204);

    const listedAfterRemove = await (
      await request(`/rnet/v0/vibes/${vibeId}/objects`, { headers: owner })
    ).json();
    expect(
      listedAfterRemove.mediaObjects.some(
        (item: { uri: string }) => item.uri === repeatableMediaObjectUri,
      ),
    ).toBe(false);
  });

  test("lets a granted dMachine read but never exposes origins", async () => {
    const vibe = await request(`/rnet/v0/vibes/${vibeId}`, { headers: dmachine });
    expect(vibe.status).toBe(200);
    const mediaObjectResponse = await request(`/rnet/v0/objects/${mediaObjectId}`, {
      headers: dmachine,
    });
    expect(mediaObjectResponse.status).toBe(200);
    expect(mediaObjectResponse.headers.get("ETag")).toBeNull();
    const origin = await request(`/rnet/v0/origins/${originUri.split("/").at(-1)}`, {
      headers: dmachine,
    });
    expect(origin.status).toBe(403);
  });

  test("serializes overlapping last-write-wins edits and retains both in history", async () => {
    let startWrites!: () => void;
    const start = new Promise<void>((resolve) => {
      startWrites = resolve;
    });
    const write = async (category: string) => {
      await start;
      return request(`/rnet/v0/objects/${mediaObjectId}/user`, {
        method: "PATCH",
        headers: dmachine,
        json: { properties: { category } },
      });
    };
    const pendingWrites = [write("coffee"), write("food")];
    startWrites();
    const writes = await Promise.all(pendingWrites);
    expect(writes.map(({ status }) => status)).toEqual([200, 200]);
    expect(writes.every((response) => response.headers.get("ETag") === null)).toBe(true);

    const corrupt = await request(`/rnet/v0/objects/${mediaObjectId}/user`, {
      method: "PATCH",
      headers: dmachine,
      json: { properties: {}, source: { properties: { amount: 0 } } },
    });
    expect(corrupt.status).toBe(422);
    const current = (await (
      await request(`/rnet/v0/objects/${mediaObjectId}`, { headers: dmachine })
    ).json()) as MediaObject;
    expect(current.source.properties.amount).toBe("-6.50");

    const history = await db
      .select({ revision: mediaObjectRevisions.rev, snapshot: mediaObjectRevisions.snapshot })
      .from(mediaObjectRevisions)
      .where(
        and(
          eq(mediaObjectRevisions.mediaObjectUuid, mediaObjectId),
          eq(mediaObjectRevisions.block, "user"),
        ),
      )
      .orderBy(asc(mediaObjectRevisions.rev));
    expect(history).toHaveLength(2);
    expect(history.map(({ revision }) => revision)).toEqual([1, 2]);
    expect(history.map(({ snapshot }) => snapshot?.properties)).toEqual(
      expect.arrayContaining([{ category: "coffee" }, { category: "food" }]),
    );
    expect(history.at(-1)?.snapshot?.properties).toEqual(current.user?.properties);
  });

  test("serializes concurrent inferred writes without losing either task", async () => {
    let startWrites!: () => void;
    const start = new Promise<void>((resolve) => {
      startWrites = resolve;
    });
    const write = async (task: string, value: string) => {
      await start;
      return request(`/rnet/v0/objects/${mediaObjectId}/inferred`, {
        method: "PUT",
        headers: dmachine,
        json: {
          task,
          entry: { model: "test/concurrent", properties: { value } },
        },
      });
    };
    const pendingWrites = [write("concurrent_alpha", "alpha"), write("concurrent_beta", "beta")];
    startWrites();
    const writes = await Promise.all(pendingWrites);
    expect(writes.map(({ status }) => status)).toEqual([200, 200]);

    const current = (await (
      await request(`/rnet/v0/objects/${mediaObjectId}`, { headers: dmachine })
    ).json()) as MediaObject;
    expect(current.inferred?.["rbudget:concurrent_alpha"]?.properties).toEqual({ value: "alpha" });
    expect(current.inferred?.["rbudget:concurrent_beta"]?.properties).toEqual({ value: "beta" });

    const history = await db
      .select({ revision: mediaObjectRevisions.rev, snapshot: mediaObjectRevisions.snapshot })
      .from(mediaObjectRevisions)
      .where(
        and(
          eq(mediaObjectRevisions.mediaObjectUuid, mediaObjectId),
          eq(mediaObjectRevisions.block, "inferred"),
        ),
      )
      .orderBy(asc(mediaObjectRevisions.rev));
    expect(history.map(({ revision }) => revision)).toEqual([1, 2]);
    expect(history.at(-1)?.snapshot).toMatchObject({
      "rbudget:concurrent_alpha": { properties: { value: "alpha" } },
      "rbudget:concurrent_beta": { properties: { value: "beta" } },
    });
  });

  test("server-grounds client-authored objects and prefixes inference", async () => {
    const clientSuppliedSource = await request("/rnet/v0/objects", {
      method: "POST",
      headers: dmachine,
      json: {
        vibe: `rnet://vibe/${vibeId}`,
        objects: [
          {
            type: "note",
            source: {
              ingest: { method: "authored", reproducible: false },
              origins: ["rnet://client/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b48"],
              properties: { title: "Must not be silently discarded" },
            },
          },
        ],
      },
    });
    expect(clientSuppliedSource.status).toBe(422);

    const ownerWithoutSource = await request("/rnet/v0/objects", {
      method: "POST",
      headers: owner,
      json: { objects: [{ type: "note" }] },
    });
    expect(ownerWithoutSource.status).toBe(422);

    const detachedUpload = await app.request("http://rhizome.test/rnet/v0/elements", {
      method: "POST",
      headers: { ...dmachine, "Content-Type": "text/plain", "X-Rnet-Kind": "text" },
      body: "Detached dMachine upload",
    });
    expect(detachedUpload.status).toBe(403);

    const [beforeRejectedUpload] = await client.unsafe(
      "select count(*)::int as elements from media_elements",
    );
    const missingUpload = await request("/rnet/v0/objects", {
      method: "POST",
      headers: dmachine,
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

    const unreferencedUpload = await request("/rnet/v0/objects", {
      method: "POST",
      headers: dmachine,
      json: {
        vibe: `rnet://vibe/${vibeId}`,
        objects: [{ type: "note", properties: { title: "Must reference its upload" } }],
      },
      uploads: { stray: { bytes: "Unreferenced bytes", mime: "text/plain" } },
    });
    expect(unreferencedUpload.status).toBe(422);
    const [afterUnreferencedUpload] = await client.unsafe(
      "select count(*)::int as elements from media_elements",
    );
    expect(afterUnreferencedUpload?.elements).toBe(beforeRejectedUpload?.elements);

    const created = await request("/rnet/v0/objects", {
      method: "POST",
      headers: dmachine,
      json: {
        vibe: `rnet://vibe/${vibeId}`,
        objects: [
          {
            type: "note",
            elements: [{ upload: "note", kind: "text", mime: "text/plain" }],
            properties: { title: "dMachine-authored" },
          },
        ],
      },
      uploads: {
        note: { bytes: "A dMachine-authored note", mime: "text/plain" },
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
      { headers: dmachine },
    );
    expect(mediaElementRead.status).toBe(200);
    const mediaElement = await mediaElementRead.json();
    expect(mediaElement.owner).toBe(document.owner);
    expect(mediaElement.content_hash).toMatch(/^sha256:[a-f0-9]{64}$/);

    const inferred = await request(`/rnet/v0/objects/${mediaObjectId}/inferred`, {
      method: "PUT",
      headers: dmachine,
      json: { task: "forecast", entry: { model: "test/model", properties: { next: 42 } } },
    });
    expect(inferred.status).toBe(200);
    expect((await inferred.json()).inferred["rbudget:forecast"].properties.next).toBe(42);

    const spoof = await request(`/rnet/v0/objects/${mediaObjectId}/inferred`, {
      method: "PUT",
      headers: dmachine,
      json: { task: "rhizome:forecast", entry: { model: "test/model", properties: {} } },
    });
    expect(spoof.status).toBe(422);

    const durableTask = await request(`/rnet/v0/objects/${mediaObjectId}/inferred`, {
      method: "PUT",
      headers: dmachine,
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

  test("creates a shared upload once across batched media objects", async () => {
    const response = await request("/rnet/v0/objects", {
      method: "POST",
      headers: dmachine,
      json: {
        vibe: `rnet://vibe/${vibeId}`,
        objects: [
          {
            type: "note",
            elements: [{ upload: "shared", kind: "text", mime: "text/plain" }],
            properties: { title: "First reference" },
          },
          {
            type: "note",
            elements: [{ upload: "shared", kind: "text", mime: "text/plain" }],
            properties: { title: "Second reference" },
          },
        ],
      },
      uploads: { shared: { bytes: "Shared element", mime: "text/plain" } },
    });

    expect(response.status).toBe(201);
    const mediaObjects = (await response.json()).mediaObjects;
    expect(mediaObjects).toHaveLength(2);
    expect(mediaObjects[0].elements[0]).toBe(mediaObjects[1].elements[0]);
    const mediaElementUuid = mediaObjects[0].elements[0].split("/").at(-1);
    const [stored] = await client.unsafe(
      "select count(*)::int as elements from media_elements where uuid = $1",
      [mediaElementUuid],
    );
    expect(stored?.elements).toBe(1);
  });

  test("does not treat same-owner record identifiers as dMachine capabilities", async () => {
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
      headers: dmachine,
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
      headers: dmachine,
      json: {
        vibe: `rnet://vibe/${vibeId}`,
        objects: [{ type: "note", elements: [privateElement.uri], properties: {} }],
      },
    });
    expect(attachKnownElement.status).toBe(403);
  });

  test("owner tombstones preserve object references while metadata and bytes disappear", async () => {
    const originResponse = await app.request("http://rhizome.test/rnet/v0/origins", {
      method: "POST",
      headers: { ...owner, "Content-Type": "text/plain" },
      body: "Disposable origin",
    });
    expect(originResponse.status).toBe(201);
    const disposableOrigin = await originResponse.json();

    const elementResponse = await app.request("http://rhizome.test/rnet/v0/elements", {
      method: "POST",
      headers: { ...owner, "Content-Type": "text/plain", "X-Rnet-Kind": "text" },
      body: "Disposable element",
    });
    expect(elementResponse.status).toBe(201);
    const disposableElement = await elementResponse.json();

    expect(disposableOrigin.bytes).toBe(
      `http://rhizome.test/rnet/v0/origins/${disposableOrigin.uri.split("/").at(-1)}/bytes`,
    );
    expect(disposableElement.bytes).toBe(
      `http://rhizome.test/rnet/v0/elements/${disposableElement.uri.split("/").at(-1)}/bytes`,
    );
    const originBytes = await app.request(disposableOrigin.bytes, { headers: owner });
    const elementBytes = await app.request(disposableElement.bytes, { headers: owner });
    expect(originBytes.status).toBe(200);
    expect(originBytes.headers.get("Content-Type")).toBe("text/plain");
    expect(elementBytes.status).toBe(200);
    expect(elementBytes.headers.get("Content-Type")).toBe("text/plain");

    const mediaObjectResponse = await request("/rnet/v0/objects", {
      method: "POST",
      headers: owner,
      json: {
        objects: [
          {
            type: "note",
            elements: [disposableElement.uri],
            source: {
              ingest: { method: "parser", reproducible: true },
              origins: [disposableOrigin.uri],
              properties: {},
            },
          },
        ],
      },
    });
    expect(mediaObjectResponse.status).toBe(201);
    const mediaObject = (await mediaObjectResponse.json()).mediaObjects[0];
    const elementId = disposableElement.uri.split("/").at(-1);
    const originId = disposableOrigin.uri.split("/").at(-1);

    expect(
      (await request(`/rnet/v0/elements/${elementId}`, { method: "DELETE", headers: otherOwner }))
        .status,
    ).toBe(403);
    expect(
      (await request(`/rnet/v0/origins/${originId}`, { method: "DELETE", headers: otherOwner }))
        .status,
    ).toBe(403);
    expect(
      (await request(`/rnet/v0/elements/${elementId}`, { method: "DELETE", headers: owner }))
        .status,
    ).toBe(204);
    expect(
      (await request(`/rnet/v0/origins/${originId}`, { method: "DELETE", headers: owner })).status,
    ).toBe(204);

    expect((await request(`/rnet/v0/elements/${elementId}`, { headers: owner })).status).toBe(404);
    expect((await request(`/rnet/v0/elements/${elementId}/bytes`, { headers: owner })).status).toBe(
      404,
    );
    expect((await request(`/rnet/v0/origins/${originId}`, { headers: owner })).status).toBe(404);
    expect((await request(`/rnet/v0/origins/${originId}/bytes`, { headers: owner })).status).toBe(
      404,
    );

    const preservedObject = await request(`/rnet/v0/objects/${mediaObject.uri.split("/").at(-1)}`, {
      headers: owner,
    });
    expect(preservedObject.status).toBe(200);
    const preservedDocument = await preservedObject.json();
    expect(preservedDocument.elements).toEqual([disposableElement.uri]);
    expect(preservedDocument.source.origins).toEqual([disposableOrigin.uri]);
  });

  test("deletes a Vibe without deleting dMachine-created records", async () => {
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
      headers: dmachine,
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
    expect((await request(`/rnet/v0/vibes/${vibeId}`, { headers: dmachine })).status).toBe(403);
    const audit = await client.unsafe(
      `select revoked_at is not null as revoked from grants where vibe_uuid = $1 and subject = 'client:rbudget'`,
      [vibeId],
    );
    expect(audit[0]?.revoked).toBe(true);
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

async function waitForOperation(
  initial: OperationDocument,
  headers: Record<string, string>,
): Promise<OperationDocument> {
  let operation = initial;
  for (
    let attempt = 0;
    attempt < 100 && ["queued", "running"].includes(operation.status);
    attempt += 1
  ) {
    await Bun.sleep(10);
    const response = await request(`/rnet/v0/operations/${operation.operation_id}`, { headers });
    expect(response.status).toBe(200);
    operation = (await response.json()) as OperationDocument;
  }
  return operation;
}

async function createCsvSourceFixture(label: string): Promise<{
  origin: { uri: string };
  source: { source: string };
}> {
  const bytes = await Bun.file(
    new URL("../../ingest/skills/csv/fixtures/rhizome-bank.csv", import.meta.url),
  ).text();
  const originResponse = await app.request("http://rhizome.test/rnet/v0/origins", {
    method: "POST",
    headers: { ...owner, "Content-Type": "text/csv", "X-Rnet-Label": label },
    body: bytes,
  });
  expect(originResponse.status).toBe(201);
  const origin = (await originResponse.json()) as { uri: string };
  const sourceResponse = await request("/rnet/v0/ingestion-sources", {
    method: "POST",
    headers: owner,
    json: { origin: origin.uri, parser: "csv" },
  });
  expect(sourceResponse.status).toBe(201);
  return {
    origin,
    source: (await sourceResponse.json()) as { source: string },
  };
}

async function mediaObjectCount(): Promise<number> {
  const [row] = await client.unsafe("select count(*)::int as count from media_objects");
  return row?.count ?? 0;
}

async function sourceBindingCount(source: string): Promise<number> {
  const [row] = await client.unsafe(
    "select count(*)::int as count from ingestion_source_objects where source_uuid = $1",
    [sourceUuid(source)],
  );
  return row?.count ?? 0;
}

function sourceUuid(source: string): string {
  return source.slice("source:".length);
}
