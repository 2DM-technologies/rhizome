import { afterEach, afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { PushOperationResult } from "@rhizome/store-contract";
import { DEV_DMACHINE_UUID, DEV_USER_UUID, type Actor } from "../src/auth.ts";
import type { BlobStore } from "../src/blobs/types.ts";
import { createDatabase } from "../src/db/index.ts";
import { seedDb } from "../src/db/seedDb.ts";
import { mediaElements } from "../src/db/models/media-element.ts";
import { mediaObjectElements } from "../src/db/models/media-object-element.ts";
import { mediaObjects } from "../src/db/models/media-object.ts";
import { mediaObjectRevisions } from "../src/db/models/media-object-revision.ts";
import { meterEntries } from "../src/db/models/meter-entry.ts";
import { operations } from "../src/db/models/operation.ts";
import { vibeMediaObjects } from "../src/db/models/vibe-media-object.ts";
import { vibes } from "../src/db/models/vibe.ts";
import { MeterLedger } from "../src/metering/meter-ledger.ts";
import { FakeModelConnector } from "../src/inference/fake-connector.ts";
import {
  ModelConnectorError,
  type CompletionRequest,
  type ModelUsage,
} from "../src/inference/model-connector.ts";
import { FifoLimiter, type PushConcurrency } from "../src/push/concurrency.ts";
import { ImportPushPipelineCatalog } from "../src/push/import-push-pipeline.ts";
import { DEFAULT_PUSH_LIMITS, type PushLimits } from "../src/push/limits.ts";
import { PushService } from "../src/push/push-service.ts";
import type { PushActivity } from "../src/push/inference-status.ts";
import { PushTaskCatalog, type PushTaskDefinition } from "../src/push/task-catalog.ts";
import { RNET_SCHEMA_VERSION } from "../src/rnet.ts";
import { PNG } from "./fixtures/push-images.ts";

const databaseUrl = process.env.RHIZOME_TEST_DATABASE_URL ?? "postgres://localhost/rhizome_m1_test";
const { db, client } = createDatabase(databaseUrl, { max: 6 });
const actor: Actor = {
  kind: "user",
  uuid: DEV_USER_UUID,
  subject: `id:rnet://id/${DEV_USER_UUID}`,
};
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
  providerRequestId: "request",
  durationMs: 1,
  attempts: 1,
};
const task: PushTaskDefinition = {
  name: "parallel-label",
  level: "object",
  label: "Label",
  description: "Concurrency fixture",
  prompt: "Label these records.",
  effort: "low",
  outputTokens: { base: 128, perObject: 64 },
  outputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["label"],
    properties: { label: { type: "string" } },
  },
};
const elementTask: PushTaskDefinition = { ...task, level: "element", elementKinds: ["image"] };
const vibeTask: PushTaskDefinition = { ...task, level: "vibe" };
const tasks = new PushTaskCatalog([task, elementTask, vibeTask]);
const blobs: BlobStore = {
  get: async () => ({ bytes: PNG }),
  put: async () => {},
  delete: async () => {},
  signedUrl: async () => "",
};
beforeAll(async () => {
  await seedDb(db);
});
afterAll(async () => {
  await client.end();
});

const cleanups: Array<() => void> = [];
const started: string[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  await Promise.all(started.splice(0).map(terminal));
});
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  cleanups.push(resolve);
  return { promise, resolve };
}
async function until(check: () => boolean | Promise<boolean>) {
  const end = Date.now() + 4000;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("Timed out waiting for controlled push state");
    await Bun.sleep(5);
  }
}
function response(request: CompletionRequest) {
  const data = JSON.parse(request.input.slice(6, -7));
  const records = data.objects ?? data.elements;
  return {
    usage: { ...usage, providerRequestId: `call-${request.trace.call}` },
    output:
      records && !data.vibe
        ? {
            results: records
              .map((record: { ref: string }) => ({
                ref: record.ref,
                result: { label: `call-${request.trace.call}-${record.ref}` },
              }))
              .reverse(),
          }
        : { label: "vibe" },
  };
}
function service(
  fake: FakeModelConnector,
  concurrency?: PushConcurrency,
  limits: Partial<PushLimits> = {},
  store = blobs,
) {
  return new PushService({
    db,
    blobs: store,
    modelConnectors: { connector: fake, target, identity: "openai/gpt-5.6-luna" },
    pushTasks: tasks,
    importPushPipelines: new ImportPushPipelineCatalog([], tasks),
    pushLimits: { ...DEFAULT_PUSH_LIMITS, maxObjectsPerCall: 1, ...limits },
    pushConcurrency: concurrency,
  });
}
async function fixture(count: number, images = false) {
  const vibeUuid = uuidv7();
  await db.insert(vibes).values({
    uuid: vibeUuid,
    ownerUuid: DEV_USER_UUID,
    title: "Parallel fixture",
    rnetSchema: RNET_SCHEMA_VERSION,
  });
  const ids: string[] = [];
  const elements: string[] = [];
  for (let i = 0; i < count; i++) {
    const uuid = uuidv7();
    ids.push(uuid);
    await db.insert(mediaObjects).values({
      uuid,
      ownerUuid: DEV_USER_UUID,
      createdBy: "rhizome",
      type: "garden.plant",
      rnetSchema: RNET_SCHEMA_VERSION,
      source: {
        properties: { title: `Plant ${i}` },
        origins: [`rnet://client/${DEV_DMACHINE_UUID}`],
        ingest: { method: "authored", reproducible: false },
      },
    });
    await db.insert(vibeMediaObjects).values({ vibeUuid, mediaObjectUuid: uuid, position: i });
    if (images) {
      const elementUuid = uuidv7();
      elements.push(elementUuid);
      await db.insert(mediaElements).values({
        uuid: elementUuid,
        ownerUuid: DEV_USER_UUID,
        createdBy: "rhizome",
        kind: "image",
        mime: "image/png",
        byteSize: PNG.length,
        contentHash: `sha256:${"0".repeat(64)}`,
        rnetSchema: RNET_SCHEMA_VERSION,
      });
      await db
        .insert(mediaObjectElements)
        .values({ mediaObjectUuid: uuid, mediaElementUuid: elementUuid, position: 0 });
    }
  }
  return { vibeUuid, ids, elements };
}
async function start(
  push: PushService,
  vibeUuid: string,
  level: "object" | "element" | "vibe" = "object",
) {
  const operation = await push.startPush(vibeUuid, { level, task: task.name }, actor);
  started.push(operation.uuid);
  return operation;
}
async function terminal(uuid: string) {
  await until(async () => {
    const op = await db.query.operations.findFirst({ where: eq(operations.uuid, uuid) });
    return !!op?.finishedAt;
  });
  const operation = (await db.query.operations.findFirst({ where: eq(operations.uuid, uuid) }))!;
  return { ...operation, result: operation.result as PushOperationResult };
}
async function meter(uuid: string) {
  return (await db.query.meterEntries.findFirst({ where: eq(meterEntries.operationUuid, uuid) }))!;
}

describe("parallel push batches", () => {
  test("c=1/2/4 bound real overlap and retain ordered UUID results with immutable metered IDs", async () => {
    for (const concurrency of [1, 2, 4]) {
      const gates = Array.from({ length: 4 }, gate);
      const fake = new FakeModelConnector({
        respond: async (request) => {
          await gates[request.trace.call - 1]!.promise;
          return response(request);
        },
      });
      const push = service(fake, { batchesPerOperation: concurrency });
      const { vibeUuid, ids } = await fixture(4);
      const op = await start(push, vibeUuid);
      await until(() => fake.requests.length === concurrency);
      await Bun.sleep(20);
      expect(fake.requests).toHaveLength(concurrency);
      // Reverse completions, then release any later serial calls.
      for (let i = concurrency - 1; i >= 0; i--) {
        gates[i]!.resolve();
        await until(async () => (await meter(op.uuid)).turns! >= concurrency - i);
      }
      for (let i = concurrency; i < 4; i++) gates[i]!.resolve();
      const finished = await terminal(op.uuid);
      expect(finished.status).toBe("done");
      expect(finished.result).toMatchObject({
        objects: { written: 4 },
        written: ids.map((uuid) => ({ uri: `rnet://object/${uuid}` })),
        usage: { tokens_in: 400, tokens_out: 80 },
        llm_calls: 4,
      });
      const ledger = await meter(op.uuid);
      expect(ledger).toMatchObject({
        turns: 4,
        tokensIn: 400,
        tokensOut: 80,
        breakdown: {
          status: "done",
          calls: [1, 2, 3, 4].map((index) => ({ index, provider_request_id: `call-${index}` })),
        },
      });
      expect(ledger.usd).toBe(finished.result.usage!.usd);
      expect(ledger.usd).toBe((Number(fake.reportCost(usage, target).usd) * 4).toFixed(6));
      for (let i = 0; i < ids.length; i++) {
        const record = await db.query.mediaObjects.findFirst({
          where: eq(mediaObjects.uuid, ids[i]!),
        });
        expect(record?.inferred[`rhizome:${task.name}`]?.properties.label).toBe(`call-${i + 1}-o1`);
      }
    }
  });

  test("default two batches stay visible independently when the second finishes first", async () => {
    const first = gate(),
      second = gate();
    const fake = new FakeModelConnector({
      respond: async (request) => {
        await (request.trace.call === 1 ? first : second).promise;
        return response(request);
      },
    });
    const push = service(fake);
    const { vibeUuid, ids } = await fixture(2);
    const op = await start(push, vibeUuid);
    await until(() => fake.requests.length === 2);
    for (const uuid of ids)
      expect((await push.getObjectInferenceStatus(uuid, actor)).records[0]!.tasks[0]!.status).toBe(
        "running",
      );
    second.resolve();
    await until(
      async () =>
        (await push.getObjectInferenceStatus(ids[1]!, actor)).records[0]!.tasks.length === 0,
    );
    expect((await push.getObjectInferenceStatus(ids[0]!, actor)).records[0]!.tasks[0]!.status).toBe(
      "running",
    );
    first.resolve();
    await terminal(op.uuid);
  });

  test("four shared calls cap multiple service instances and Vibe-level calls", async () => {
    const hold = gate();
    let active = 0,
      peak = 0;
    const fake = new FakeModelConnector({
      respond: async (request) => {
        active++;
        peak = Math.max(peak, active);
        await hold.promise;
        active--;
        return response(request);
      },
    });
    const fixtures = await Promise.all([fixture(2), fixture(2), fixture(1)]);
    const ops = [];
    ops.push(await start(service(fake), fixtures[0]!.vibeUuid));
    ops.push(await start(service(fake), fixtures[1]!.vibeUuid));
    await until(() => fake.requests.length === 4);
    ops.push(await start(service(fake), fixtures[2]!.vibeUuid, "vibe"));
    await Bun.sleep(30);
    expect(fake.requests).toHaveLength(4);
    hold.resolve();
    for (const op of ops) expect((await terminal(op.uuid)).status).toBe("done");
    expect(peak).toBe(4);
    expect(fake.requests).toHaveLength(5);
  });

  test("fatal errors settle and meter a sibling before finalization without starting later batches", async () => {
    for (const kind of ["auth", "invalid_request", "unexpected"] as const) {
      const fail = gate(),
        sibling = gate();
      const fake = new FakeModelConnector({
        respond: async (request) => {
          await (request.trace.call === 1 ? fail : sibling).promise;
          if (request.trace.call === 1) {
            if (kind === "unexpected") throw new Error("unexpected");
            return new ModelConnectorError(kind, { retryable: false, usage });
          }
          return response(request);
        },
      });
      const { vibeUuid, ids } = await fixture(5);
      const op = await start(service(fake), vibeUuid);
      await until(() => fake.requests.length === 2);
      fail.resolve();
      await Bun.sleep(30);
      expect(
        (await db.query.operations.findFirst({ where: eq(operations.uuid, op.uuid) }))?.finishedAt,
      ).toBeNull();
      expect(fake.requests).toHaveLength(2);
      sibling.resolve();
      const finished = await terminal(op.uuid);
      expect(finished.status).toBe("failed");
      expect(finished.result.usage?.tokens_in).toBe(kind === "unexpected" ? 100 : 200);
      expect(
        await db
          .select()
          .from(mediaObjectRevisions)
          .where(inArray(mediaObjectRevisions.mediaObjectUuid, ids)),
      ).toHaveLength(0);
      const snapshot = await meter(op.uuid);
      await Bun.sleep(20);
      expect(await meter(op.uuid)).toEqual(snapshot);
    }
  });

  test("wall abort meters every started call and awaits late successful responses before finalizing", async () => {
    const late = gate();
    const fake = new FakeModelConnector({
      respond: async (request) => {
        if (request.trace.call === 2) {
          await late.promise;
          return response(request);
        }
        await new Promise<void>((resolve) => {
          if (request.signal.aborted) resolve();
          else request.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return new ModelConnectorError("aborted", { retryable: false, usage });
      },
    });
    const { vibeUuid } = await fixture(4);
    const op = await start(service(fake, undefined, { maxWallMs: 150 }), vibeUuid);
    await until(() => fake.requests.length === 2);
    await until(() => fake.requests[0]!.signal.aborted);
    expect(
      (await db.query.operations.findFirst({ where: eq(operations.uuid, op.uuid) }))?.finishedAt,
    ).toBeNull();
    late.resolve();
    const finished = await terminal(op.uuid);
    expect(finished.status).toBe("aborted");
    expect(finished.result).toMatchObject({
      abort_reason: "max_wall",
      objects: { written: 0, skipped: 4 },
      usage: { tokens_in: 200 },
    });
    expect(fake.requests).toHaveLength(2);
  });

  test("shared-slot waits expire at the acceptance deadline with no call, usage, or producer", async () => {
    const slots = new FifoLimiter(1);
    const release = await slots.acquire(new AbortController().signal);
    cleanups.push(release);
    const fake = new FakeModelConnector({ respond: response });
    const { vibeUuid } = await fixture(2);
    const op = await start(service(fake, { sharedCalls: slots }, { maxWallMs: 100 }), vibeUuid);
    const finished = await terminal(op.uuid);
    expect(finished.status).toBe("aborted");
    expect(finished.result).toMatchObject({ model: null, llm_calls: 0, abort_reason: "max_wall" });
    release();
    await Bun.sleep(20);
    expect(fake.requests).toHaveLength(0);
    const next = await fixture(1);
    expect(
      (await terminal((await start(service(fake, { sharedCalls: slots }), next.vibeUuid)).uuid))
        .status,
    ).toBe("done");
  });

  test("exact call ceilings and bounded observed-token overshoot retain admitted results", async () => {
    for (const limits of [{ maxCalls: 1 }, { maxTokens: 1 }]) {
      const hold = gate();
      const fake = new FakeModelConnector({
        respond: async (request) => {
          await hold.promise;
          return response(request);
        },
      });
      const { vibeUuid } = await fixture(5);
      const op = await start(service(fake, undefined, limits), vibeUuid);
      const count = limits.maxCalls ? 1 : 2;
      await until(() => fake.requests.length === count);
      hold.resolve();
      const finished = await terminal(op.uuid);
      expect(fake.requests).toHaveLength(count);
      expect(finished.status).toBe("aborted");
      expect(finished.result).toMatchObject({
        abort_reason: limits.maxCalls ? "max_turns" : "max_tokens",
        objects: { written: count, skipped: 5 - count },
        usage: { tokens_in: 100 * count },
      });
    }
    const fake = new FakeModelConnector({ respond: response });
    const { vibeUuid } = await fixture(1);
    const finished = await terminal(
      (await start(service(fake, undefined, { maxCalls: 1 }), vibeUuid)).uuid,
    );
    expect(finished.status).toBe("done");
  });

  test("queued calls recheck token and call ceilings after obtaining a shared slot", async () => {
    for (const limits of [{ maxTokens: 1 }, { maxCalls: 1 }]) {
      const hold = gate();
      const fake = new FakeModelConnector({
        respond: async (request) => {
          await hold.promise;
          return response(request);
        },
      });
      const { vibeUuid } = await fixture(2);
      const op = await start(service(fake, { sharedCalls: new FifoLimiter(1) }, limits), vibeUuid);
      await until(() => fake.requests.length === 1);
      await Bun.sleep(20);
      hold.resolve();
      const finished = await terminal(op.uuid);
      expect(fake.requests).toHaveLength(1);
      expect(finished.result).toMatchObject({
        objects: { written: 1, skipped: 1 },
        abort_reason: limits.maxCalls ? "max_turns" : "max_tokens",
      });
    }
  });

  test("a failed terminal transaction releases activity while preserving paid writes and usage", async () => {
    const fake = new FakeModelConnector({ respond: response });
    const push = service(fake);
    const { vibeUuid, ids } = await fixture(1);
    const close = spyOn(MeterLedger.prototype, "close").mockRejectedValue(
      new Error("injected terminal transaction failure"),
    );
    const log = spyOn(console, "error").mockImplementation(() => {});
    let operationUuid: string | undefined;
    try {
      const op = await push.startPush(vibeUuid, { level: "object", task: task.name }, actor);
      operationUuid = op.uuid;
      await until(() => log.mock.calls.some(([message]) => message === "Push finalization failed"));
      const activity = (push as unknown as { activity: PushActivity }).activity;
      expect(activity.calls.has(op.uuid)).toBe(false);
      expect(activity.settled.has(op.uuid)).toBe(false);
      expect((Reflect.get(activity, "batches") as Map<string, unknown>).has(op.uuid)).toBe(false);
      const row = await db.query.operations.findFirst({ where: eq(operations.uuid, op.uuid) });
      expect(row?.status).toBe("running");
      expect(row?.finishedAt).toBeNull();
      expect(await meter(op.uuid)).toMatchObject({ turns: 1, tokensIn: 100 });
      const object = await db.query.mediaObjects.findFirst({
        where: eq(mediaObjects.uuid, ids[0]!),
      });
      expect(object?.inferredRev).toBe(1);
      expect(log.mock.calls).toEqual([["Push finalization failed", op.uuid]]);
    } finally {
      close.mockRestore();
      log.mockRestore();
      if (operationUuid)
        await db
          .update(operations)
          .set({ status: "failed", finishedAt: new Date(), error: "test cleanup" })
          .where(eq(operations.uuid, operationUuid));
    }
  });

  test("exhausting the call budget finishes normally when only oversized lookahead remains", async () => {
    for (const batchesPerOperation of [1, 2]) {
      for (const level of ["object", "element"] as const) {
        const hold = gate();
        const fake = new FakeModelConnector({
          respond: async (request) => {
            if (batchesPerOperation === 2) await hold.promise;
            return response(request);
          },
        });
        const { vibeUuid, ids, elements } = await fixture(3, level === "element");
        const tooLarge = level === "object" ? ids[2]! : elements[2]!;
        if (level === "element")
          await db
            .update(mediaElements)
            .set({ alt: "oversized-lookahead" })
            .where(eq(mediaElements.uuid, tooLarge));
        else {
          const object = (await db.query.mediaObjects.findFirst({
            where: eq(mediaObjects.uuid, tooLarge),
          }))!;
          await db
            .update(mediaObjects)
            .set({ source: { ...object.source, properties: { title: "oversized-lookahead" } } })
            .where(eq(mediaObjects.uuid, tooLarge));
        }
        // Make the final record unambiguously too large, independent of tokenizer estimates.
        fake.countTokens = async ({ input }) => (input.includes("oversized-lookahead") ? 1_001 : 1);
        const op = await start(
          service(fake, { batchesPerOperation }, { maxCalls: 2, maxInputTokensPerCall: 1_000 }),
          vibeUuid,
          level,
        );
        await until(() => fake.requests.length === 2);
        hold.resolve();
        const finished = await terminal(op.uuid);
        expect(fake.requests).toHaveLength(2);
        expect(finished.status, `${level} with ${batchesPerOperation} batches`).toBe("done");
        expect(finished.result).toMatchObject({
          abort_reason: null,
          llm_calls: 2,
          [level === "object" ? "objects" : "elements"]: { written: 2, skipped: 1 },
          skipped: [{ uri: `rnet://${level}/${tooLarge}`, reason: "context_too_large" }],
        });
      }
    }
  });

  test("an exhausted call budget does not fetch image bytes beyond the prepared lookahead", async () => {
    let reads = 0;
    const store = {
      ...blobs,
      get: async () => {
        reads++;
        return { bytes: PNG };
      },
    };
    const fake = new FakeModelConnector({ respond: response });
    const { vibeUuid } = await fixture(6, true);
    const op = await start(
      service(fake, { batchesPerOperation: 1 }, { maxCalls: 1 }, store),
      vibeUuid,
      "element",
    );
    const finished = await terminal(op.uuid);
    expect(fake.requests).toHaveLength(1);
    expect(reads).toBeLessThanOrEqual(2);
    expect(finished.result).toMatchObject({
      abort_reason: "max_turns",
      elements: { written: 1, skipped: 5 },
    });
  });

  test("out-of-order multi-record envelopes retain refs within each batch", async () => {
    const first = gate();
    const fake = new FakeModelConnector({
      respond: async (request) => {
        if (request.trace.call === 1) await first.promise;
        return response(request);
      },
    });
    const { vibeUuid, ids } = await fixture(4);
    const op = await start(service(fake, undefined, { maxObjectsPerCall: 2 }), vibeUuid);
    await until(async () => (await meter(op.uuid)).turns === 1);
    first.resolve();
    const finished = await terminal(op.uuid);
    expect(finished.result).toMatchObject({
      objects: { written: 4 },
      written: ids.map((uuid) => ({ uri: `rnet://object/${uuid}` })),
    });
    for (let i = 0; i < ids.length; i++) {
      const record = await db.query.mediaObjects.findFirst({
        where: eq(mediaObjects.uuid, ids[i]!),
      });
      expect(record?.inferred[`rhizome:${task.name}`]?.properties.label).toBe(
        `call-${Math.floor(i / 2) + 1}-o${(i % 2) + 1}`,
      );
    }
  });

  test("a pricing exception cannot poison sibling accounting or allow writes after failure", async () => {
    const first = gate(),
      second = gate();
    const fake = new FakeModelConnector({
      respond: async (request) => {
        await (request.trace.call === 1 ? first : second).promise;
        return response(request);
      },
    });
    const price = fake.reportCost.bind(fake);
    fake.reportCost = (reported, model) => {
      if (reported.providerRequestId === "call-1") throw new Error("pricing failure");
      return price(reported, model);
    };
    const { vibeUuid } = await fixture(4);
    const op = await start(service(fake), vibeUuid);
    await until(() => fake.requests.length === 2);
    first.resolve();
    await until(async () => (await meter(op.uuid)).tokensIn === 100);
    second.resolve();
    const finished = await terminal(op.uuid);
    expect(finished.status).toBe("failed");
    expect(finished.result).toMatchObject({
      objects: { written: 0 },
      llm_calls: 2,
      usage: { tokens_in: 200, tokens_out: 40, usd: price(usage, target).usd },
    });
    expect((await meter(op.uuid)).breakdown).toMatchObject({
      status: "failed",
      calls: [{ index: 1 }, { index: 2 }],
    });
    expect(fake.requests).toHaveLength(2);
  });

  test("ledger records serialize even while a database lock stalls their whole-row snapshots", async () => {
    const { vibeUuid } = await fixture(0);
    const operationUuid = uuidv7();
    const connector = new FakeModelConnector();
    const registry = { connector, target, identity: "openai/gpt-5.6-luna" };
    await db.transaction(async (transaction) => {
      await transaction.insert(operations).values({
        uuid: operationUuid,
        kind: "push",
        status: "running",
        ownerUuid: DEV_USER_UUID,
        invokedBy: actor.subject,
        vibeUuid,
        request: {},
      });
      await MeterLedger.open(transaction, registry, operationUuid, task.name, actor.subject);
    });
    const ledger = await MeterLedger.load(db, operationUuid, registry);
    const locked = gate(),
      release = gate();
    const blocker = db.transaction(async (transaction) => {
      await transaction
        .select()
        .from(meterEntries)
        .where(eq(meterEntries.operationUuid, operationUuid))
        .for("update");
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    const first = ledger.record(usage, { index: 2, objects: 1, outcome: "completed" });
    const second = ledger.record(usage, { index: 1, objects: 1, outcome: "completed" });
    try {
      await until(() => ledger.usage.tokens_in > 0);
      await Bun.sleep(20);
      expect(ledger.usage.tokens_in).toBe(100);
      expect((await meter(operationUuid)).tokensIn).toBe(0);
    } finally {
      release.resolve();
      await blocker;
      await Promise.all([first, second]);
      await ledger.drain();
    }
    expect(await meter(operationUuid)).toMatchObject({
      tokensIn: 200,
      tokensOut: 40,
      turns: 2,
      breakdown: { calls: [{ index: 1 }, { index: 2 }] },
    });
    await db.transaction(async (transaction) => {
      await ledger.close(transaction, "done", 1, null);
      await transaction
        .update(operations)
        .set({ status: "done", finishedAt: new Date() })
        .where(eq(operations.uuid, operationUuid));
    });
  });

  test("image buffering stays at two batch payloads plus one lookahead while shared calls wait", async () => {
    const slots = new FifoLimiter(1);
    const release = await slots.acquire(new AbortController().signal);
    cleanups.push(release);
    let reads = 0;
    const store = {
      ...blobs,
      get: async () => {
        reads++;
        return { bytes: PNG };
      },
    };
    const fake = new FakeModelConnector({ respond: response });
    const { vibeUuid, elements } = await fixture(7, true);
    const op = await start(service(fake, { sharedCalls: slots }, {}, store), vibeUuid, "element");
    await until(() => reads === 3);
    await Bun.sleep(20);
    expect(reads).toBe(3);
    expect(fake.requests).toHaveLength(0);
    release();
    const finished = await terminal(op.uuid);
    expect(finished.result).toMatchObject({
      elements: { written: 7 },
      written: elements.map((uuid) => ({ uri: `rnet://element/${uuid}` })),
    });
  });
});
