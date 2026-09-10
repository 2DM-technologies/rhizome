import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import S3rver from "s3rver";
import { v7 as uuidv7 } from "uuid";
import {
  isPushOperation,
  pushOperationResultSchema,
  storeTaskKey,
  type OperationDocument,
  type PushOperationResult,
  type PushVibeRequest,
} from "@rhizome/store-contract";
import { validateSchema } from "@rnet/types";
import { createApp, type AppDependencies } from "../src/app.ts";
import { DEV_USER_UUID, DEV_DMACHINE_UUID } from "../src/auth.ts";
import { createBlobStore } from "../src/blobs/index.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, createProviderLeasePool } from "../src/db/index.ts";
import { grants } from "../src/db/models/grant.ts";
import { mediaObjects } from "../src/db/models/media-object.ts";
import { mediaElements } from "../src/db/models/media-element.ts";
import { mediaObjectElements } from "../src/db/models/media-object-element.ts";
import { mediaObjectRevisions } from "../src/db/models/media-object-revision.ts";
import { mediaElementRevisions } from "../src/db/models/media-element-revision.ts";
import { meterEntries } from "../src/db/models/meter-entry.ts";
import { operations, type DbOperation } from "../src/db/models/operation.ts";
import { vibeMediaObjects } from "../src/db/models/vibe-media-object.ts";
import { vibeRevisions } from "../src/db/models/vibe-revision.ts";
import { vibes } from "../src/db/models/vibe.ts";
import { ingestionSources } from "../src/db/models/ingestion-source.ts";
import { ingestionSourceFetches } from "../src/db/models/ingestion-source-fetch.ts";
import { originArtifacts } from "../src/db/models/origin-artifact.ts";
import { seedDb } from "../src/db/seedDb.ts";
import { FakeModelConnector } from "../src/inference/fake-connector.ts";
import {
  ModelConnectorError,
  type CompletionRequest,
  type CompletionResult,
  type ModelUsage,
} from "../src/inference/model-connector.ts";
import { MeterLedger } from "../src/metering/meter-ledger.ts";
import { DEFAULT_PUSH_LIMITS } from "../src/push/limits.ts";
import { finalizePush } from "../src/push/push-service.ts";
import { PushTaskCatalog, type PushTaskDefinition } from "../src/push/task-catalog.ts";
import { summarize } from "../src/push/tasks/vibe/summarize/manifest.ts";
import { displayName } from "../src/push/tasks/object/display_name/manifest.ts";
import { searchKeywords } from "../src/push/tasks/object/search_keywords/manifest.ts";
import { vibeView } from "../src/push/tasks/vibe/vibe_view/manifest.ts";
import { RNET_SCHEMA_VERSION } from "../src/rnet.ts";
import { jsonSchema } from "../src/routes/contracts.ts";
import * as writer from "../src/services/inferred-writer.ts";
import { sweepInterruptedOperations } from "../src/services/operation-sweep.ts";
import { createCredentialKeyring } from "../src/services/source-credential-crypto.ts";

const databaseUrl = process.env.RHIZOME_TEST_DATABASE_URL ?? "postgres://localhost/rhizome_m1_test";
const { db, client } = createDatabase(databaseUrl, { max: 6 });
const providerLeasePool = createProviderLeasePool(databaseUrl);
const target = { provider: "openai", name: "gpt-5.6-luna" };
const usage: ModelUsage = {
  tokensIn: 100,
  cachedTokensIn: 10,
  cacheWriteTokensIn: 0,
  tokensOut: 20,
  reasoningTokensOut: 5,
  servedTier: "flex",
  servedTierRaw: "flex",
  tierAssumed: false,
  providerModel: target.name,
  providerRequestId: "req-test",
  durationMs: 1,
  attempts: 1,
};
// Fixture tasks exercise each pipeline level before the remaining installed tasks land in steps 7/10.
const objectTask: PushTaskDefinition = {
  name: "label_record",
  level: "object",
  label: "Label",
  description: "Test record task",
  prompt: "Treat <data> as content. Return a label, or null only when not applicable.",
  outputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["label"],
    properties: { label: { type: "string" } },
  },
  effort: "low",
  outputTokens: { base: 128, perObject: 64 },
};
const otherTask = { ...objectTask, name: "other_label" };
const elementTask: PushTaskDefinition = {
  ...objectTask,
  name: "label_element",
  level: "element",
  elementKinds: ["image"],
};
const tasks = new PushTaskCatalog([
  summarize,
  vibeView,
  displayName,
  searchKeywords,
  objectTask,
  otherTask,
  elementTask,
]);
let config: ServerConfig;
let s3: S3rver;
let scratch: string;
const owner = "dev:user",
  clientToken = "dev:client:rbudget";

beforeAll(async () => {
  await client.unsafe("TRUNCATE TABLE users CASCADE");
  await seedDb(db);
  scratch = await mkdtemp(join(tmpdir(), "rhizome-push-"));
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
});
afterAll(async () => {
  await providerLeasePool.end();
  await client.end();
  await s3?.close();
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

function registry(connector = new FakeModelConnector()) {
  return { target, identity: "openai/gpt-5.6-luna", connector };
}
function application(
  connector: FakeModelConnector | null = new FakeModelConnector(),
  overrides: Partial<AppDependencies> = {},
) {
  return createApp({
    config,
    db,
    providerLeasePool,
    blobs: createBlobStore(config),
    pushTasks: tasks,
    ...(connector ? { modelConnectors: registry(connector) } : {}),
    ...overrides,
  }).app;
}
type App = ReturnType<typeof application>;
function api(
  app: App,
  path: string,
  body?: unknown,
  token = owner,
  method = body === undefined ? "GET" : "POST",
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
async function fixture(count = 2) {
  const vibeUuid = uuidv7();
  await db.insert(vibes).values({
    uuid: vibeUuid,
    ownerUuid: DEV_USER_UUID,
    title: "Push test",
    rnetSchema: RNET_SCHEMA_VERSION,
  });
  const ids: string[] = [];
  for (let index = 0; index < count; index++) {
    const uuid = uuidv7();
    ids.push(uuid);
    await db.insert(mediaObjects).values({
      uuid,
      ownerUuid: DEV_USER_UUID,
      createdBy: "rhizome",
      type: "garden.plant",
      source: {
        properties: { title: `Plant ${index}` },
        origins: [`rnet://client/${DEV_DMACHINE_UUID}`],
        ingest: { method: "authored", reproducible: false },
      },
      rnetSchema: RNET_SCHEMA_VERSION,
    });
    await db.insert(vibeMediaObjects).values({ vibeUuid, mediaObjectUuid: uuid, position: index });
  }
  return { vibeUuid, ids };
}
async function imageFor(objectUuid: string, kind: "image" | "text" = "image") {
  const uuid = uuidv7();
  await db.insert(mediaElements).values({
    uuid,
    ownerUuid: DEV_USER_UUID,
    createdBy: "rhizome",
    kind,
    mime: kind === "image" ? "image/png" : "text/plain",
    byteSize: 8,
    contentHash: `sha256:${"a".repeat(64)}`,
    rnetSchema: RNET_SCHEMA_VERSION,
  });
  await db
    .insert(mediaObjectElements)
    .values({ mediaObjectUuid: objectUuid, mediaElementUuid: uuid, position: 0 });
  return uuid;
}
async function accept(
  app: App,
  vibeUuid: string,
  input: PushVibeRequest = { level: "object", task: objectTask.name },
  token = owner,
) {
  const response = await api(app, `/vibes/${vibeUuid}/push`, input, token);
  expect(response.status).toBe(202);
  const operation = (await response.json()) as OperationDocument;
  expect(operation.request).not.toHaveProperty("resolved");
  return operation;
}
async function poll(
  app: App,
  uuid: string,
): Promise<OperationDocument & { result: PushOperationResult }> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const response = await api(app, `/operations/${uuid}`);
    expect(response.status).toBe(200);
    const operation = (await response.json()) as OperationDocument;
    if (!["queued", "running"].includes(operation.status)) {
      expect(isPushOperation(operation)).toBe(true);
      expect(jsonSchema(pushOperationResultSchema).validate(operation.result).ok).toBe(true);
      expect(operation.result).toHaveProperty("usage");
      return operation as OperationDocument & { result: PushOperationResult };
    }
    await Bun.sleep(5);
  }
  throw new Error("Push did not finish");
}
async function run(app: App, vibeUuid: string, input?: PushVibeRequest) {
  return poll(app, (await accept(app, vibeUuid, input)).operation_id);
}
function responseFor(
  request: CompletionRequest,
  result: Record<string, unknown> | null = { label: "fern" },
): CompletionResult {
  const data = JSON.parse(request.input.slice(6, -7));
  const records = data.objects ?? data.elements;
  return {
    usage,
    output: { results: records.map((record: { ref: string }) => ({ ref: record.ref, result })) },
  };
}
const oldEntry = {
  model: "old",
  inferred_at: "2026-09-10T00:00:00Z",
  properties: { label: "old" },
};
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function manualOperation(status: "queued" | "running" = "running") {
  const { vibeUuid } = await fixture(0);
  const uuid = uuidv7();
  const [operation] = await db
    .insert(operations)
    .values({
      uuid,
      kind: "push",
      status,
      ownerUuid: DEV_USER_UUID,
      invokedBy: "rhizome",
      vibeUuid,
      request: {
        mode: "push",
        level: "vibe",
        task: summarize.name,
        vibe: `rnet://vibe/${vibeUuid}`,
        resolved: { selection: [], outcomes_before_run: { preserved_durable: [] } },
      },
    })
    .returning();
  const configured = registry();
  await db.transaction((transaction) =>
    MeterLedger.open(transaction, configured, uuid, summarize.name, "rhizome"),
  );
  return { operation: operation!, ledger: await MeterLedger.load(db, uuid, configured) };
}

describe("push lifecycle and inferred writes", () => {
  test("element null outcomes remove nondurable entries, leave absent entries alone, and preserve durable entries", async () => {
    const { vibeUuid, ids } = await fixture(3);
    const elements = await Promise.all(ids.map((uuid) => imageFor(uuid)));
    const key = storeTaskKey(elementTask.name);
    await db
      .update(mediaElements)
      .set({ inferred: { [key]: oldEntry } })
      .where(eq(mediaElements.uuid, elements[0]!));
    const durable = { ...oldEntry, durable: true };
    await db
      .update(mediaElements)
      .set({ inferred: { [key]: durable } })
      .where(eq(mediaElements.uuid, elements[2]!));
    const app = application(
      new FakeModelConnector({ respond: (request) => responseFor(request, null) }),
    );
    const operation = await run(app, vibeUuid, { level: "element", task: elementTask.name });
    expect(operation.result).toMatchObject({
      elements: { selected: 3, sent: 2, removed: 1, skipped: 1, preserved_durable: 1 },
    });
    expect(
      (await db.query.mediaElements.findFirst({ where: eq(mediaElements.uuid, elements[0]!) }))
        ?.inferred,
    ).toEqual({});
    expect(
      (await db.query.mediaElements.findFirst({ where: eq(mediaElements.uuid, elements[2]!) }))
        ?.inferred[key],
    ).toEqual(durable);
    expect(
      await db
        .select()
        .from(mediaElementRevisions)
        .where(inArray(mediaElementRevisions.mediaElementUuid, elements)),
    ).toHaveLength(1);
  });
  test("the writer validates the whole merged block and rejects durable output", async () => {
    const { vibeUuid, ids } = await fixture(1);
    const pending = await manualOperation();
    await db
      .update(mediaObjects)
      .set({ inferred: { "external:broken": { model: "", properties: {} } } })
      .where(eq(mediaObjects.uuid, ids[0]!));
    await expect(
      writer.writeObjectTaskInferred(db, {
        mediaObjectUuid: ids[0]!,
        task: objectTask.name,
        entry: oldEntry,
        operationUuid: pending.operation.uuid,
      }),
    ).rejects.toThrow("Invalid object inferred block");
    expect(
      (await db.query.mediaObjects.findFirst({ where: eq(mediaObjects.uuid, ids[0]!) }))
        ?.inferredRev,
    ).toBe(0);
    await expect(
      writer.writeVibeTaskInferred(db, {
        vibeUuid,
        task: summarize.name,
        entry: { ...oldEntry, durable: false },
        operationUuid: pending.operation.uuid,
      }),
    ).rejects.toThrow("never writes durable");
  });
  test("the finalizer rejects its own invalid result, closes the ledger, and finalizes only once", async () => {
    const { operation, ledger } = await manualOperation();
    await finalizePush(db, {
      operationUuid: operation.uuid,
      ledger,
      status: "done",
      result: { level: "vibe", vibe: null },
      error: null,
      committed: false,
      createdAt: operation.createdAt,
    });
    const finished = await db.query.operations.findFirst({
      where: eq(operations.uuid, operation.uuid),
    });
    expect(finished).toMatchObject({
      status: "failed",
      result: null,
      error: "The push operation could not complete.",
    });
    expect(finished?.finishedAt).not.toBeNull();
    const meter = await db.query.meterEntries.findFirst({
      where: eq(meterEntries.operationUuid, operation.uuid),
    });
    expect(meter?.durationMs).not.toBeNull();
    expect(meter?.breakdown?.status).toBe("failed");
    await finalizePush(db, {
      operationUuid: operation.uuid,
      ledger,
      status: "done",
      result: {
        level: "vibe",
        task: summarize.name,
        model: null,
        llm_calls: 0,
        usage: ledger.usage,
        context: { truncated_objects: 0, truncated_pointers: 0, clipped_objects: 0 },
        abort_reason: null,
        vibe: { outcome: "skipped", reason: "aborted" },
      },
      error: null,
      committed: true,
      createdAt: operation.createdAt,
    });
    expect(
      await db.query.operations.findFirst({ where: eq(operations.uuid, operation.uuid) }),
    ).toEqual(finished);
    expect(
      await db.query.meterEntries.findFirst({
        where: eq(meterEntries.operationUuid, operation.uuid),
      }),
    ).toEqual(meter);
  });
  test("boot sweep fails interrupted runs and rejects open fetches without changing origins or meters", async () => {
    const queued = await manualOperation("queued"),
      running = await manualOperation("running");
    await running.ledger.record(usage, { index: 1, objects: 1, outcome: "completed" });
    await db
      .update(operations)
      .set({ kind: "pull", request: { mode: "import_preview" } })
      .where(eq(operations.uuid, queued.operation.uuid));
    const beforeMeters = await db
      .select()
      .from(meterEntries)
      .where(inArray(meterEntries.operationUuid, [queued.operation.uuid, running.operation.uuid]))
      .orderBy(meterEntries.operationUuid);
    const originUuid = uuidv7();
    await db.insert(originArtifacts).values({
      uuid: originUuid,
      ownerUuid: DEV_USER_UUID,
      contentHash: `sha256:${"b".repeat(64)}`,
      mime: "text/plain",
      byteSize: 1,
      rnetSchema: RNET_SCHEMA_VERSION,
    });
    const origin = await db.query.originArtifacts.findFirst({
      where: eq(originArtifacts.uuid, originUuid),
    });
    const limits = {
      maxCandidates: 1,
      maxCaptureBytes: 1024,
      maxElementBytes: 1024,
      maxTotalElementBytes: 1024,
    };
    const fetchIds: string[] = [];
    for (const operation of [queued.operation, running.operation])
      for (const status of ["fetching", "fetched", "verified"] as const) {
        const sourceUuid = uuidv7(),
          fetchUuid = uuidv7();
        fetchIds.push(fetchUuid);
        await db.insert(ingestionSources).values({
          uuid: sourceUuid,
          ownerUuid: DEV_USER_UUID,
          kind: "remote",
          skillId: "test",
          connectorVersion: "test@1",
          parser: "test",
          parserVersion: "test@1",
          executionLimits: limits,
        });
        await db.insert(ingestionSourceFetches).values({
          uuid: fetchUuid,
          sourceUuid,
          ownerUuid: DEV_USER_UUID,
          operationUuid: operation.uuid,
          status,
          connectorVersion: "test@1",
          parserVersion: "test@1",
          sourceStateDigest: "test",
          executionLimits: limits,
          ...(fetchIds.length === 1 ? { originUuid } : {}),
        });
      }
    await sweepInterruptedOperations(db);
    for (const uuid of [queued.operation.uuid, running.operation.uuid])
      expect(
        await db.query.operations.findFirst({ where: eq(operations.uuid, uuid) }),
      ).toMatchObject({
        status: "failed",
        error: "interrupted",
        finishedAt: expect.any(Date),
        result: null,
      });
    for (const uuid of fetchIds)
      expect(
        await db.query.ingestionSourceFetches.findFirst({
          where: eq(ingestionSourceFetches.uuid, uuid),
        }),
      ).toMatchObject({ status: "rejected", errorCode: "interrupted" });
    expect(
      await db
        .select()
        .from(meterEntries)
        .where(inArray(meterEntries.operationUuid, [queued.operation.uuid, running.operation.uuid]))
        .orderBy(meterEntries.operationUuid),
    ).toEqual(beforeMeters);
    expect(
      await db.query.originArtifacts.findFirst({ where: eq(originArtifacts.uuid, originUuid) }),
    ).toEqual(origin);
    // App construction (including OpenAPI generation) never invokes the sweep.
    const stillQueued = await manualOperation("queued");
    application();
    expect(
      (
        await db.query.operations.findFirst({
          where: eq(operations.uuid, stillQueued.operation.uuid),
        })
      )?.status,
    ).toBe("queued");
  });
  test("rule-decided and preserved Vibe runs report the producer table's zero-call variants", async () => {
    const ruleTask: PushTaskDefinition = {
      ...objectTask,
      name: "rule_fixture",
      level: "vibe",
      rules: () => ({ label: "rule label" }),
    };
    const fake = new FakeModelConnector();
    const app = application(fake, { pushTasks: new PushTaskCatalog([ruleTask, summarize]) });
    const { vibeUuid } = await fixture();
    const rule = await run(app, vibeUuid, { level: "vibe", task: ruleTask.name });
    expect(rule.result).toMatchObject({
      model: "rhizome/rule_fixture-rules@1",
      llm_calls: 0,
      vibe: { outcome: "written" },
      usage: { usd: "0.000000" },
    });
    expect(
      (await db.query.vibes.findFirst({ where: eq(vibes.uuid, vibeUuid) }))?.inferred[
        storeTaskKey(ruleTask.name)
      ]?.model,
    ).toBe("rhizome/rule_fixture-rules@1");
    expect(
      (
        await db.query.meterEntries.findFirst({
          where: eq(meterEntries.operationUuid, rule.operation_id),
        })
      )?.model,
    ).toBe(registry(fake).identity);
    await db
      .update(vibes)
      .set({ inferred: { [storeTaskKey(summarize.name)]: { ...oldEntry, durable: true } } })
      .where(eq(vibes.uuid, vibeUuid));
    const preserved = await run(app, vibeUuid, { level: "vibe", task: summarize.name });
    expect(preserved.result).toMatchObject({
      model: null,
      llm_calls: 0,
      vibe: { outcome: "preserved_durable", key: storeTaskKey(summarize.name) },
      usage: { usd: "0.000000" },
    });
    expect(preserved.result).not.toHaveProperty("vibe.rev");
    expect(fake.requests).toHaveLength(0);
  });
  test("the installed vibe_view rule path records the rule producer and makes no model call", async () => {
    const fake = new FakeModelConnector();
    const { vibeUuid } = await fixture();
    const operation = await run(application(fake), vibeUuid, {
      level: "vibe",
      task: vibeView.name,
    });
    expect(operation.result).toMatchObject({
      model: "rhizome/vibe_view-rules@1",
      llm_calls: 0,
      vibe: { outcome: "written" },
      usage: { usd: "0.000000" },
    });
    expect(
      (await db.query.vibes.findFirst({ where: eq(vibes.uuid, vibeUuid) }))?.inferred[
        storeTaskKey(vibeView.name)
      ],
    ).toMatchObject({
      model: "rhizome/vibe_view-rules@1",
      properties: { view: "datatable" },
    });
    expect(fake.requests).toHaveLength(0);
    expect(
      (
        await db.query.meterEntries.findFirst({
          where: eq(meterEntries.operationUuid, operation.operation_id),
        })
      )?.model,
    ).toBe(registry(fake).identity);
  });
  test("the installed mixed-Vibe vibe_view model path accepts an observed pointer", async () => {
    const { vibeUuid, ids } = await fixture(2);
    await db
      .update(mediaObjects)
      .set({ type: "transaction" })
      .where(eq(mediaObjects.uuid, ids[1]!));
    await imageFor(ids[0]!);
    const fake = new FakeModelConnector({
      respond: () => ({
        usage,
        output: {
          view: "simplelist",
          config: { subtitle_pointer: "/source/properties/title" },
        },
      }),
    });
    const operation = await run(application(fake), vibeUuid, {
      level: "vibe",
      task: vibeView.name,
    });
    expect(operation.result).toMatchObject({
      model: registry(fake).identity,
      llm_calls: 1,
      vibe: { outcome: "written" },
    });
    expect(
      (await db.query.vibes.findFirst({ where: eq(vibes.uuid, vibeUuid) }))?.inferred[
        storeTaskKey(vibeView.name)
      ]?.properties,
    ).toEqual({
      view: "simplelist",
      config: { subtitle_pointer: "/source/properties/title" },
    });
    expect(fake.requests).toHaveLength(1);
  });
  test("vibe_view rejects model pointers and config branches that fail its context post-check", async () => {
    for (const output of [
      {
        view: "simplelist",
        config: { subtitle_pointer: "/source/properties/missing" },
      },
      {
        view: "simplelist",
        config: { caption_pointer: "/source/properties/title" },
      },
    ]) {
      const { vibeUuid, ids } = await fixture(2);
      await db
        .update(mediaObjects)
        .set({ type: "transaction" })
        .where(eq(mediaObjects.uuid, ids[1]!));
      await imageFor(ids[0]!);
      const fake = new FakeModelConnector({ respond: () => ({ usage, output }) });
      const operation = await run(application(fake), vibeUuid, {
        level: "vibe",
        task: vibeView.name,
      });
      expect(operation.result).toMatchObject({
        llm_calls: 1,
        vibe: { outcome: "skipped", reason: "invalid_output" },
        usage: { tokens_in: usage.tokensIn, tokens_out: usage.tokensOut },
      });
      expect(
        (await db.query.vibes.findFirst({ where: eq(vibes.uuid, vibeUuid) }))?.inferred[
          storeTaskKey(vibeView.name)
        ],
      ).toBeUndefined();
    }
  });
  test("installed search_keywords evaluates an image-only object by observed shape", async () => {
    const { vibeUuid, ids } = await fixture(2);
    await db
      .update(mediaObjects)
      .set({
        source: {
          properties: {},
          origins: [`rnet://client/${DEV_DMACHINE_UUID}`],
          ingest: { method: "authored", reproducible: false },
        },
      })
      .where(eq(mediaObjects.uuid, ids[0]!));
    await imageFor(ids[0]!);
    const fake = new FakeModelConnector({
      respond: (request) => {
        const data = JSON.parse(request.input.slice(6, -7));
        return {
          usage,
          output: {
            results: data.objects.map((record: { ref: string; elements: unknown[] }) => ({
              ref: record.ref,
              result: record.elements.length ? { keywords: ["image"] } : null,
            })),
          },
        };
      },
    });
    const operation = await run(application(fake), vibeUuid, {
      level: "object",
      task: searchKeywords.name,
    });
    expect(operation.result).toMatchObject({
      objects: { selected: 2, sent: 2, written: 1, skipped: 1 },
      skipped: [{ uri: `rnet://object/${ids[1]}`, reason: "not_applicable" }],
    });
    const written = await db.query.mediaObjects.findFirst({
      where: eq(mediaObjects.uuid, ids[0]!),
    });
    expect(written?.inferred[storeTaskKey(searchKeywords.name)]?.properties).toEqual({
      keywords: ["image"],
    });
    expect(
      (await db.query.mediaObjects.findFirst({ where: eq(mediaObjects.uuid, ids[1]!) }))?.inferred[
        storeTaskKey(searchKeywords.name)
      ],
    ).toBeUndefined();
    expect(
      await db.query.mediaObjectRevisions.findFirst({
        where: and(
          eq(mediaObjectRevisions.mediaObjectUuid, ids[0]!),
          eq(mediaObjectRevisions.block, "inferred"),
        ),
      }),
    ).toMatchObject({
      operationUuid: operation.operation_id,
      rev: written!.inferredRev,
    });
    const meter = await db.query.meterEntries.findFirst({
      where: eq(meterEntries.operationUuid, operation.operation_id),
    });
    expect(Number(meter?.usd)).toBeGreaterThan(0);
    expect(meter?.breakdown).toMatchObject({
      rate_card: {
        id: expect.any(String),
        source: expect.any(String),
        verified_at: expect.any(String),
      },
    });
  });
  test("a missing object at write time fails the run while earlier revisions stand", async () => {
    const { vibeUuid, ids } = await fixture(2);
    const fake = new FakeModelConnector({
      respond: async (request) => {
        if (request.trace.call === 2) {
          await db.delete(vibeMediaObjects).where(eq(vibeMediaObjects.mediaObjectUuid, ids[1]!));
          await db.delete(mediaObjects).where(eq(mediaObjects.uuid, ids[1]!));
        }
        return responseFor(request);
      },
    });
    const app = application(fake, { pushLimits: { ...DEFAULT_PUSH_LIMITS, maxObjectsPerCall: 1 } });
    const operation = await run(app, vibeUuid);
    expect(operation.status).toBe("failed");
    expect(operation.result).toMatchObject({
      objects: { written: 1, skipped: 1 },
      usage: { tokens_in: 200 },
    });
    expect(operation.committed_at).toBeDefined();
  });
  test("a deleted Vibe fails its write and remains pollable by its owner", async () => {
    const { vibeUuid } = await fixture();
    const fake = new FakeModelConnector({
      respond: async () => {
        await db.delete(vibes).where(eq(vibes.uuid, vibeUuid));
        return { usage, output: { summary: "new", tags: ["new"], confidence: 0.5 } };
      },
    });
    const app = application(fake);
    const operation = await run(app, vibeUuid, { level: "vibe", task: summarize.name });
    expect(operation.status).toBe("failed");
    expect(operation.result).toMatchObject({
      vibe: { outcome: "skipped", reason: "aborted" },
      usage: { tokens_in: 100 },
    });
    expect(
      (await db.query.operations.findFirst({ where: eq(operations.uuid, operation.operation_id) }))
        ?.vibeUuid,
    ).toBeNull();
  });
  test("simultaneous accepts serialize and an old running row does not block", async () => {
    const { vibeUuid } = await fixture();
    const released = gate();
    const fake = new FakeModelConnector({
      respond: async (request) => {
        await released.promise;
        return responseFor(request);
      },
    });
    const app = application(fake);
    try {
      const responses = await Promise.all([
        api(app, `/vibes/${vibeUuid}/push`, { level: "object", task: objectTask.name }),
        api(app, `/vibes/${vibeUuid}/push`, { level: "object", task: objectTask.name }),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([202, 409]);
      released.resolve();
      const accepted = (await responses
        .find((response) => response.status === 202)!
        .json()) as OperationDocument;
      await poll(app, accepted.operation_id);
    } finally {
      released.resolve();
    }
    await db.insert(operations).values({
      uuid: uuidv7(),
      kind: "push",
      status: "running",
      ownerUuid: DEV_USER_UUID,
      invokedBy: "rhizome",
      vibeUuid,
      request: { mode: "push", level: "object", task: objectTask.name },
      createdAt: new Date(Date.now() - DEFAULT_PUSH_LIMITS.maxWallMs - 61_000),
    });
    expect((await run(app, vibeUuid)).status).toBe("done");
  });
  test("locked writes preserve a client's inferred key and an owner edit landing during completion", async () => {
    const { vibeUuid, ids } = await fixture(1);
    const entered = gate(),
      released = gate();
    const fake = new FakeModelConnector({
      respond: async (request) => {
        entered.resolve();
        await released.promise;
        return responseFor(request);
      },
    });
    const app = application(fake);
    await db
      .insert(grants)
      .values({ vibeUuid, subject: "client:rbudget", scopes: ["write:inferred"] });
    const accepted = await accept(app, vibeUuid);
    try {
      await entered.promise;
      expect(
        (
          await api(
            app,
            `/objects/${ids[0]}/inferred`,
            { task: "annotation", entry: oldEntry },
            clientToken,
            "PUT",
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await api(
            app,
            `/objects/${ids[0]}/user`,
            { properties: { note: "edit during call" } },
            owner,
            "PATCH",
          )
        ).status,
      ).toBe(200);
    } finally {
      released.resolve();
    }
    await poll(app, accepted.operation_id);
    const row = await db.query.mediaObjects.findFirst({ where: eq(mediaObjects.uuid, ids[0]!) });
    expect(row?.inferred).toHaveProperty("rbudget:annotation");
    expect(row?.inferred).toHaveProperty(storeTaskKey(objectTask.name));
    expect(row?.user?.properties.note).toBe("edit during call");
    expect(row?.inferredRev).toBe(2);
    const revisions = await db
      .select()
      .from(mediaObjectRevisions)
      .where(
        and(
          eq(mediaObjectRevisions.mediaObjectUuid, ids[0]!),
          eq(mediaObjectRevisions.block, "inferred"),
        ),
      )
      .orderBy(mediaObjectRevisions.rev);
    expect(revisions.map((revision) => revision.rev)).toEqual([1, 2]);
  });
  test("different tasks running together keep each other's keys", async () => {
    const { vibeUuid, ids } = await fixture(1);
    const entered = gate(),
      released = gate();
    let calls = 0;
    const fake = new FakeModelConnector({
      respond: async (request) => {
        if (++calls === 2) entered.resolve();
        await released.promise;
        return responseFor(request);
      },
    });
    const app = application(fake);
    const first = await accept(app, vibeUuid);
    const second = await accept(app, vibeUuid, { level: "object", task: otherTask.name });
    try {
      await entered.promise;
    } finally {
      released.resolve();
    }
    await Promise.all([poll(app, first.operation_id), poll(app, second.operation_id)]);
    const row = await db.query.mediaObjects.findFirst({ where: eq(mediaObjects.uuid, ids[0]!) });
    expect(row?.inferred).toHaveProperty(storeTaskKey(objectTask.name));
    expect(row?.inferred).toHaveProperty(storeTaskKey(otherTask.name));
    expect(row?.inferredRev).toBe(2);
  });
  test("durability landing mid-call is rechecked under the object and Vibe locks", async () => {
    for (const level of ["object", "vibe"] as const) {
      const { vibeUuid, ids } = await fixture(1);
      const entered = gate(),
        released = gate();
      const task = level === "vibe" ? summarize : objectTask;
      const key = storeTaskKey(task.name);
      const fake = new FakeModelConnector({
        respond: async (request) => {
          entered.resolve();
          await released.promise;
          return level === "vibe"
            ? { usage, output: { summary: "new", tags: ["new"], confidence: 0.5 } }
            : responseFor(request);
        },
      });
      const app = application(fake);
      const accepted = await accept(app, vibeUuid, { level, task: task.name });
      const durable = { ...oldEntry, durable: true };
      try {
        await entered.promise;
        if (level === "vibe")
          await db
            .update(vibes)
            .set({ inferred: { [key]: durable } })
            .where(eq(vibes.uuid, vibeUuid));
        else
          await db
            .update(mediaObjects)
            .set({ inferred: { [key]: durable } })
            .where(eq(mediaObjects.uuid, ids[0]!));
      } finally {
        released.resolve();
      }
      const operation = await poll(app, accepted.operation_id);
      if (level === "vibe") {
        expect(operation.result).toMatchObject({
          vibe: { outcome: "skipped", reason: "preserved_durable" },
        });
        expect(
          (await db.query.vibes.findFirst({ where: eq(vibes.uuid, vibeUuid) }))?.inferred[key],
        ).toEqual(durable);
      } else {
        expect(operation.result).toMatchObject({
          objects: { preserved_durable: 0, skipped: 1 },
          skipped: [{ reason: "preserved_durable" }],
        });
        expect(
          (await db.query.mediaObjects.findFirst({ where: eq(mediaObjects.uuid, ids[0]!) }))
            ?.inferred[key],
        ).toEqual(durable);
      }
    }
  });
  test("billed failures retain earlier writes, meter every response, and continue nonfatal chunks", async () => {
    const { vibeUuid } = await fixture(3);
    const fake = new FakeModelConnector({
      respond: (request) =>
        request.trace.call === 2
          ? new ModelConnectorError("provider_unavailable", { retryable: true, usage })
          : responseFor(request),
    });
    const app = application(fake, { pushLimits: { ...DEFAULT_PUSH_LIMITS, maxObjectsPerCall: 1 } });
    const operation = await run(app, vibeUuid);
    expect(operation.status).toBe("done");
    expect(operation.result).toMatchObject({
      objects: { written: 2, failed: 1 },
      llm_calls: 3,
      usage: { tokens_in: 300, tokens_out: 60 },
      skipped: [{ reason: "call_failed", code: "provider_unavailable" }],
    });
    const meter = await db.query.meterEntries.findFirst({
      where: eq(meterEntries.operationUuid, operation.operation_id),
    });
    expect(meter?.turns).toBe(3);
    expect(meter?.durationMs).not.toBeNull();
    expect(operation.committed_at).toBeDefined();
  });
  test("auth and invalid requests fail, close the ledger, and never send remaining chunks", async () => {
    for (const kind of ["auth", "invalid_request"] as const) {
      const { vibeUuid } = await fixture(2);
      const fake = new FakeModelConnector({
        respond: () => new ModelConnectorError(kind, { retryable: false, usage }),
      });
      const app = application(fake, {
        pushLimits: { ...DEFAULT_PUSH_LIMITS, maxObjectsPerCall: 1 },
      });
      const operation = await run(app, vibeUuid);
      expect(operation.status).toBe("failed");
      expect(fake.requests).toHaveLength(1);
      expect(operation.result).toMatchObject({
        objects: { failed: 1, skipped: 1 },
        usage: { tokens_in: 100 },
        skipped: [{ code: kind }, { reason: "aborted" }],
      });
      expect(
        (
          await db.query.meterEntries.findFirst({
            where: eq(meterEntries.operationUuid, operation.operation_id),
          })
        )?.durationMs,
      ).not.toBeNull();
    }
  });
  test("unexpected exceptions retain committed chunks and mark all remaining records aborted", async () => {
    const { vibeUuid } = await fixture(3);
    const fake = new FakeModelConnector({
      respond: (request) => {
        if (request.trace.call === 2) throw new Error("unexpected private failure");
        return responseFor(request);
      },
    });
    const app = application(fake, { pushLimits: { ...DEFAULT_PUSH_LIMITS, maxObjectsPerCall: 1 } });
    const operation = await run(app, vibeUuid);
    expect(operation.status).toBe("failed");
    expect(operation.error).not.toContain("private");
    expect(operation.result).toMatchObject({
      objects: { written: 1, skipped: 2 },
      usage: { tokens_in: 100 },
    });
    expect(operation.committed_at).toBeDefined();
  });
  test("a duplicate ref invalidates the whole chunk after its usage is recorded", async () => {
    const { vibeUuid, ids } = await fixture();
    const fake = new FakeModelConnector({
      respond: () => ({
        usage,
        output: {
          results: [
            { ref: "o1", result: { label: "a" } },
            { ref: "o1", result: { label: "b" } },
          ],
        },
      }),
    });
    const app = application(fake);
    const operation = await run(app, vibeUuid);
    expect(operation.result).toMatchObject({
      objects: { written: 0, failed: 2 },
      usage: { tokens_in: 100 },
      skipped: [{ reason: "invalid_output" }, { reason: "invalid_output" }],
    });
    expect(
      await db
        .select()
        .from(mediaObjectRevisions)
        .where(inArray(mediaObjectRevisions.mediaObjectUuid, ids)),
    ).toHaveLength(0);
  });
  test("tokens persist before pricing can throw", async () => {
    const { vibeUuid, ids } = await fixture(1);
    const fake = new FakeModelConnector({ respond: responseFor });
    const price = fake.reportCost.bind(fake);
    fake.reportCost = (reported, target) => {
      if (reported.tokensIn) throw new Error("pricing failed");
      return price(reported, target);
    };
    const operation = await run(application(fake), vibeUuid);
    expect(operation.status).toBe("failed");
    expect(operation.result.usage?.tokens_in).toBe(100);
    const meter = await db.query.meterEntries.findFirst({
      where: eq(meterEntries.operationUuid, operation.operation_id),
    });
    expect(meter).toMatchObject({
      tokensIn: 100,
      tokensOut: 20,
      turns: 1,
      breakdown: { calls: [{ cached_tokens_in: 10 }] },
    });
    expect(meter?.durationMs).not.toBeNull();
    expect(
      (await db.query.mediaObjects.findFirst({ where: eq(mediaObjects.uuid, ids[0]!) }))?.inferred,
    ).toEqual({});
  });
  test("call and token ceilings stop scheduling, retaining writes and usage", async () => {
    for (const [override, reason] of [
      [{ maxCalls: 1 }, "max_turns"],
      [{ maxTokens: 1 }, "max_tokens"],
    ] as const) {
      const { vibeUuid } = await fixture(3);
      const fake = new FakeModelConnector({ respond: responseFor });
      const operation = await run(
        application(fake, {
          pushLimits: { ...DEFAULT_PUSH_LIMITS, maxObjectsPerCall: 1, ...override },
        }),
        vibeUuid,
      );
      expect(operation.status).toBe("aborted");
      expect(operation.result).toMatchObject({
        abort_reason: reason,
        objects: { written: 1, skipped: 2 },
      });
      expect(operation.committed_at).toBeDefined();
      expect(fake.requests).toHaveLength(1);
    }
  });
  test("a wall abort closes a Vibe run with a skipped outcome and usage", async () => {
    const { vibeUuid } = await fixture();
    const fake = new FakeModelConnector({
      respond: (request) =>
        new Promise((resolve) => {
          const abort = () =>
            resolve(new ModelConnectorError("aborted", { retryable: false, usage }));
          if (request.signal.aborted) abort();
          else request.signal.addEventListener("abort", abort, { once: true });
        }),
    });
    const app = application(fake, { pushLimits: { ...DEFAULT_PUSH_LIMITS, maxWallMs: 150 } });
    const operation = await run(app, vibeUuid, { level: "vibe", task: summarize.name });
    expect(operation.status).toBe("aborted");
    expect(operation.result).toMatchObject({
      abort_reason: "max_wall",
      vibe: { outcome: "skipped", reason: "aborted" },
      usage: { tokens_in: 100 },
    });
  });
  test("records too large for dispatch finish done at zero cost without a producer", async () => {
    const { vibeUuid } = await fixture();
    const fake = new FakeModelConnector();
    const operation = await run(
      application(fake, { pushLimits: { ...DEFAULT_PUSH_LIMITS, maxInputTokensPerCall: 1 } }),
      vibeUuid,
    );
    expect(operation.status).toBe("done");
    expect(operation.result).toMatchObject({
      model: null,
      llm_calls: 0,
      objects: { skipped: 2 },
      usage: { usd: "0.000000" },
    });
    expect(fake.requests).toHaveLength(0);
  });
  test("discovery works keyless; scope wins before provider availability; selections and levels validate", async () => {
    const { vibeUuid, ids } = await fixture();
    const foreign = await fixture(1);
    const app = application(null);
    expect((await api(app, "/push-tasks", undefined, clientToken)).status).toBe(200);
    expect(
      (
        await api(
          app,
          `/vibes/${vibeUuid}/push`,
          { level: "object", task: objectTask.name },
          clientToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (await api(app, `/vibes/${vibeUuid}/push`, { level: "object", task: objectTask.name }))
        .status,
    ).toBe(503);
    const enabled = application();
    for (const body of [
      { task: objectTask.name },
      { level: "object", task: objectTask.name, selection: [] },
      { level: "vibe", task: summarize.name, selection: [`rnet://object/${ids[0]}`] },
      { level: "element", task: elementTask.name, selection: [`rnet://object/${ids[0]}`] },
      { level: "object", task: objectTask.name, selection: [`rnet://object/${foreign.ids[0]}`] },
      { level: "object", task: "not_installed" },
    ])
      expect((await api(enabled, `/vibes/${vibeUuid}/push`, body)).status).toBe(422);
    const image = await imageFor(ids[0]!);
    expect(
      (
        await api(
          application(undefined, { pushLimits: { ...DEFAULT_PUSH_LIMITS, maxElements: 0 } }),
          `/vibes/${vibeUuid}/push`,
          { level: "element", task: elementTask.name },
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await api(
          application(undefined, { pushLimits: { ...DEFAULT_PUSH_LIMITS, maxObjects: 1 } }),
          `/vibes/${vibeUuid}/push`,
          { level: "object", task: objectTask.name },
        )
      ).status,
    ).toBe(422);
    expect(image).toBeDefined();
  });
  test("client-invoked work is store-paid with invocation attribution and owner-only usage", async () => {
    const { vibeUuid } = await fixture(1);
    const app = application();
    await db
      .insert(grants)
      .values({ vibeUuid, subject: "client:rbudget", scopes: ["push", "read"] });
    const accepted = await accept(
      app,
      vibeUuid,
      { level: "object", task: objectTask.name },
      clientToken,
    );
    expect(accepted.request).not.toHaveProperty("selection");
    await poll(app, accepted.operation_id);
    const publicView = await (
      await api(app, `/operations/${accepted.operation_id}`, undefined, clientToken)
    ).json();
    expect(publicView.result).not.toHaveProperty("usage");
    expect(publicView.request).not.toHaveProperty("resolved");
    const meter = await db.query.meterEntries.findFirst({
      where: eq(meterEntries.operationUuid, accepted.operation_id),
    });
    expect(meter?.payer).toBe("rhizome");
    expect(meter?.breakdown?.invoked_by).toBe("client:rbudget");
  });
  test("records usage before writing, links revisions, and exposes rate-card cost", async () => {
    const { vibeUuid, ids } = await fixture();
    const fake = new FakeModelConnector({ respond: responseFor });
    const app = application(fake);
    const original = writer.writeObjectTaskInferred;
    let checked = 0;
    const spy = spyOn(writer, "writeObjectTaskInferred").mockImplementation(
      async (database, input) => {
        const meter = await db.query.meterEntries.findFirst({
          where: eq(meterEntries.operationUuid, input.operationUuid),
        });
        expect(meter?.tokensIn).toBe(usage.tokensIn);
        expect(Number(meter?.usd)).toBeGreaterThan(0);
        checked++;
        return original(database, input);
      },
    );
    let operation: Awaited<ReturnType<typeof run>>;
    try {
      operation = await run(app, vibeUuid);
    } finally {
      spy.mockRestore();
    }
    expect(operation!.status).toBe("done");
    expect(checked).toBe(2);
    const meter = await db.query.meterEntries.findFirst({
      where: eq(meterEntries.operationUuid, operation!.operation_id),
    });
    expect(meter).toMatchObject({
      payer: "rhizome",
      model: registry(fake).identity,
      tokensIn: 100,
      tokensOut: 20,
      turns: 1,
      usd: fake.reportCost(usage, target).usd,
    });
    expect(meter?.durationMs).not.toBeNull();
    expect(meter?.breakdown).toMatchObject({
      rate_card: {
        id: expect.any(String),
        source: expect.any(String),
        verified_at: expect.any(String),
      },
      calls: [{ attempts: 1, served_tier: "flex", long_context: false }],
    });
    for (const uuid of ids) {
      const row = await db.query.mediaObjects.findFirst({ where: eq(mediaObjects.uuid, uuid) });
      expect(row?.inferred[storeTaskKey(objectTask.name)]).toMatchObject({
        model: registry(fake).identity,
        properties: { label: "fern" },
      });
      expect(row?.inferred[storeTaskKey(objectTask.name)]).not.toHaveProperty("durable");
      const revision = await db.query.mediaObjectRevisions.findFirst({
        where: eq(mediaObjectRevisions.mediaObjectUuid, uuid),
      });
      expect(revision).toMatchObject({
        operationUuid: operation!.operation_id,
        actor: "rhizome",
        rev: row!.inferredRev,
        block: "inferred",
      });
    }
  });
  test("null removes only an existing non-durable key and commits a removal-only run", async () => {
    const { vibeUuid, ids } = await fixture();
    const key = storeTaskKey(objectTask.name);
    await db
      .update(mediaObjects)
      .set({ inferred: { [key]: oldEntry, "external:note": oldEntry } })
      .where(eq(mediaObjects.uuid, ids[0]!));
    const app = application(
      new FakeModelConnector({ respond: (request) => responseFor(request, null) }),
    );
    const operation = await run(app, vibeUuid);
    expect(operation.committed_at).toBeDefined();
    expect(operation.result).toMatchObject({
      objects: { removed: 1, skipped: 1, written: 0 },
      skipped: [{ reason: "not_applicable", removed: true }, { reason: "not_applicable" }],
    });
    const row = await db.query.mediaObjects.findFirst({ where: eq(mediaObjects.uuid, ids[0]!) });
    expect(row?.inferred).toEqual({ "external:note": oldEntry });
    expect(
      await db.query.mediaObjectRevisions.findFirst({
        where: eq(mediaObjectRevisions.mediaObjectUuid, ids[0]!),
      }),
    ).toMatchObject({ rev: row!.inferredRev, operationUuid: operation.operation_id });
  });
  test("all-durable and empty selections finish at zero cost with no producer", async () => {
    for (const count of [0, 2]) {
      const { vibeUuid, ids } = await fixture(count);
      const key = storeTaskKey(objectTask.name);
      const durable = { ...oldEntry, durable: true };
      if (ids.length)
        await db
          .update(mediaObjects)
          .set({ inferred: { [key]: durable } })
          .where(inArray(mediaObjects.uuid, ids));
      const fake = new FakeModelConnector();
      const app = application(fake);
      const operation = await run(app, vibeUuid);
      expect(operation.status).toBe("done");
      expect(fake.requests).toHaveLength(0);
      expect(operation.result).toMatchObject({
        model: null,
        llm_calls: 0,
        objects: { selected: count, preserved_durable: count, sent: 0 },
        usage: { usd: "0.000000", tokens_in: 0, served_tiers: [], tier_assumed: false },
      });
      for (const uuid of ids)
        expect(
          (await db.query.mediaObjects.findFirst({ where: eq(mediaObjects.uuid, uuid) }))?.inferred[
            key
          ],
        ).toEqual(durable);
    }
  });
  test("stored request separates caller selection from the deduplicated resolved workset", async () => {
    const { vibeUuid, ids } = await fixture();
    await db.insert(vibeMediaObjects).values({ vibeUuid, mediaObjectUuid: ids[0]!, position: 2 });
    const app = application();
    const accepted = await accept(app, vibeUuid);
    await poll(app, accepted.operation_id);
    expect(accepted.request).not.toHaveProperty("selection");
    const stored = await db.query.operations.findFirst({
      where: eq(operations.uuid, accepted.operation_id),
    });
    expect(stored?.request).toMatchObject({ resolved: { selection: ids } });
    expect(stored?.result).toMatchObject({ objects: { selected: 2, written: 2 } });
    const selection = [`rnet://object/${ids[1]}`];
    const selected = await accept(app, vibeUuid, {
      level: "object",
      task: objectTask.name,
      selection,
    });
    expect(selected.request.selection).toEqual(selection);
    await poll(app, selected.operation_id);
    expect(
      (await db.query.operations.findFirst({ where: eq(operations.uuid, selected.operation_id) }))
        ?.request,
    ).toMatchObject({ selection, resolved: { selection: [ids[1]] } });
  });
  test("summarize writes and validates a Vibe, uses the Vibe revision, and independently rederives", async () => {
    const { vibeUuid } = await fixture();
    const fake = new FakeModelConnector();
    const app = application(fake);
    const first = await run(app, vibeUuid, { level: "vibe", task: summarize.name });
    const second = await run(app, vibeUuid, { level: "vibe", task: summarize.name });
    expect(first.result).toMatchObject({ vibe: { outcome: "written" } });
    const data = JSON.parse(fake.requests[1]!.input.slice(6, -7));
    expect(data.vibe).not.toHaveProperty("summary");
    const document = await (await api(app, `/vibes/${vibeUuid}`)).json();
    expect(validateSchema("vibe", document).ok).toBe(true);
    expect(document.inferred[storeTaskKey(summarize.name)]).not.toHaveProperty(
      "properties.confidence",
    );
    expect(document.inferred[storeTaskKey(summarize.name)].confidence).toBe(0.5);
    const revision = await db.query.vibeRevisions.findFirst({
      where: eq(vibeRevisions.operationUuid, second.operation_id),
    });
    expect(revision?.snapshot.inferred).toEqual(document.inferred);
  });
  test("a failed Vibe call is skipped with a closed reason and billed usage", async () => {
    const { vibeUuid } = await fixture();
    const app = application(
      new FakeModelConnector({
        respond: () => new ModelConnectorError("output_refused", { retryable: false, usage }),
      }),
    );
    const operation = await run(app, vibeUuid, { level: "vibe", task: summarize.name });
    expect(operation.status).toBe("done");
    expect(operation.result).toMatchObject({
      vibe: { outcome: "skipped", reason: "call_failed", code: "output_refused" },
      usage: { tokens_in: 100, tokens_out: 20 },
    });
  });
  test("element worksets validate reachability and kind, deduplicate shared images, and use element revisions", async () => {
    const { vibeUuid, ids } = await fixture();
    const image = await imageFor(ids[0]!);
    const text = await imageFor(ids[1]!, "text");
    await db
      .insert(mediaObjectElements)
      .values({ mediaObjectUuid: ids[1]!, mediaElementUuid: image, position: 1 });
    const other = await fixture(1);
    const foreign = await imageFor(other.ids[0]!);
    const fake = new FakeModelConnector();
    const app = application(fake);
    for (const uuid of [foreign, text])
      expect(
        (
          await api(app, `/vibes/${vibeUuid}/push`, {
            level: "element",
            task: elementTask.name,
            selection: [`rnet://element/${uuid}`],
          })
        ).status,
      ).toBe(422);
    const operation = await run(app, vibeUuid, { level: "element", task: elementTask.name });
    expect(operation.result).toMatchObject({ elements: { selected: 1, written: 1 } });
    const row = await db.query.mediaElements.findFirst({ where: eq(mediaElements.uuid, image) });
    expect(row?.inferred).toHaveProperty(storeTaskKey(elementTask.name));
    expect(
      await db.query.mediaElementRevisions.findFirst({
        where: eq(mediaElementRevisions.mediaElementUuid, image),
      }),
    ).toMatchObject({
      rev: row!.inferredRev,
      actor: "rhizome",
      operationUuid: operation.operation_id,
    });
    expect(fake.requests[0]!.input).not.toContain('"vibe"');
    expect(fake.requests[0]!.input).not.toContain("Plant");
  });
});
