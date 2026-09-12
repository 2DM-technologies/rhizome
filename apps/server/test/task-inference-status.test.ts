import { describe, expect, test } from "bun:test";
import type { TaskInferenceStatusQuery } from "@rhizome/store-contract";
import type { Database } from "../src/db/index.ts";
import type { Actor } from "../src/auth.ts";
import { vibes } from "../src/db/models/vibe.ts";
import { grants } from "../src/db/models/grant.ts";
import { operations, type DbOperation } from "../src/db/models/operation.ts";
import { PushActivity } from "../src/push/inference-status.ts";
import { readTaskInferenceStatus } from "../src/push/task-inference-status.ts";
import { installedPushTasks } from "../src/push/installed-tasks.ts";
import { Problem } from "../src/errors.ts";

const uuid = "0198f2a1-1401-7501-8501-999999999999";
const owner: Actor = { kind: "user", uuid: "owner", subject: "id:owner" };
const reader: Actor = { kind: "client", uuid: "reader", name: "reader", subject: "client:reader" };
const input: TaskInferenceStatusQuery = { level: "vibe", task: "summarize" };
const task = installedPushTasks.get("vibe", "summarize")!;

function fixture() {
  const state = {
    operation: undefined as Partial<DbOperation> | undefined,
    readable: false,
    exists: true,
    operationReads: 0,
  };
  // Exercise the real access service with a minimal query adapter; no database or provider calls.
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const rows =
            table === vibes
              ? state.exists
                ? [{ uuid, ownerUuid: "owner", rev: 3 }]
                : []
              : table === grants
                ? state.readable
                  ? [{ scopes: ["read"] }]
                  : []
                : table === operations
                  ? (state.operationReads++, state.operation ? [state.operation] : [])
                  : [];
          return Object.assign(Promise.resolve(rows), {
            orderBy: () => ({ limit: async () => rows }),
          });
        },
      }),
    }),
  } as unknown as Database;
  const activity = new PushActivity();
  return {
    state,
    activity,
    read: (actor = owner, query = input) =>
      readTaskInferenceStatus(db, activity, installedPushTasks, uuid, query, actor),
  };
}

describe("task inference status", () => {
  test("includes future Vibe tasks, acceptance failures, and idle keyless state", async () => {
    const f = fixture();
    expect((await f.read()).status).toBe("idle");
    f.activity.begin(uuid, [task]);
    expect((await f.read()).status).toBe("waiting");
    f.activity.rejected(
      uuid,
      task,
      new Problem(422, "schema_violation", "Test", "Cannot start summary"),
    );
    f.activity.end(uuid);
    expect(await f.read()).toEqual({
      ...input,
      revision: 3,
      status: "error",
      message: "Cannot start summary",
    });
  });

  test("reports queued/running, interrupted and successful retry states without private data", async () => {
    const f = fixture();
    f.activity.begin(uuid, [task]);
    f.activity.accepted(uuid, task);
    f.state.operation = {
      status: "queued",
      createdAt: new Date(),
      request: { resolved: { secret: true } },
      result: { usage: { usd: 5 } },
    };
    expect((await f.read()).status).toBe("waiting");
    f.state.operation.status = "running";
    expect((await f.read()).status).toBe("running");
    f.state.operation.status = "failed";
    f.state.operation.error = "interrupted";
    expect((await f.read()).message).toBe("interrupted");
    f.state.operation = {
      status: "done",
      createdAt: new Date(),
      result: { level: "vibe", vibe: { outcome: "written" } },
    };
    expect(await f.read()).toEqual({ ...input, revision: 3, status: "done", message: null });
    expect(JSON.stringify(await f.read())).not.toMatch(/resolved|usage|secret/);
  });

  test("active work beats pending errors; a later retry clears an old acceptance error", async () => {
    const f = fixture();
    f.activity.begin(uuid, [task]);
    f.activity.rejected(uuid, task, new Error());
    f.state.operation = { status: "running", createdAt: new Date(0) };
    expect((await f.read()).status).toBe("running");
    f.state.operation = { status: "done", createdAt: new Date(Date.now() + 1000) };
    expect((await f.read()).status).toBe("done");
    f.state.operation.createdAt = new Date(0);
    expect((await f.read()).status).toBe("error");
  });

  test("failed and benign skipped results are distinguished for Vibe and record tasks", async () => {
    const f = fixture();
    f.state.operation = {
      status: "done",
      createdAt: new Date(),
      result: { level: "vibe", vibe: { outcome: "skipped", reason: "invalid_output" } },
    };
    expect((await f.read()).status).toBe("error");
    f.state.operation.result = {
      level: "object",
      skipped: [{ reason: "call_failed", code: "refusal" }],
    };
    expect((await f.read(owner, { level: "object", task: "display_name" })).message).toContain(
      "refusal",
    );
    f.state.operation.result = {
      level: "vibe",
      vibe: { outcome: "skipped", reason: "not_applicable" },
    };
    expect((await f.read()).status).toBe("done");
  });

  test("read scope is required before task discovery or operation lookup", async () => {
    const f = fixture();
    await expect(f.read(reader)).rejects.toMatchObject({ status: 403 });
    await expect(f.read(reader, { level: "object", task: "summarize" })).rejects.toMatchObject({
      status: 403,
    });
    expect(f.state.operationReads).toBe(0);
    f.state.readable = true;
    expect((await f.read(reader)).status).toBe("idle");
    await expect(f.read(reader, { level: "object", task: "summarize" })).rejects.toMatchObject({
      status: 422,
    });
    f.state.exists = false;
    await expect(f.read()).rejects.toMatchObject({ status: 404 });
  });
});

test("HTTP status route requires a task and level and passes only validated inputs", async () => {
  const { createRhizomeRouter } = await import("../src/routes/rhizome-router.ts");
  const { registerTaskInferenceStatusRoute } =
    await import("../src/routes/task-inference-status.ts");
  const router = createRhizomeRouter();
  const f = fixture();
  const calls: unknown[] = [];
  router.hono.use("*", async (context, next) => {
    context.set("actor", owner);
    await next();
  });
  router.hono.onError((error, context) => context.json({ error: error.message }, 422));
  registerTaskInferenceStatusRoute(router, {
    getTaskInferenceStatus: (id: string, query: TaskInferenceStatusQuery, actor: Actor) => {
      calls.push({ id, query, actor });
      return f.read(actor, query);
    },
  } as unknown as import("../src/push/push-service.ts").PushService);
  for (const query of [
    "",
    "?task=summarize",
    "?level=wrong&task=summarize",
    "?level=vibe&task=bad:name",
    "?level=vibe&task=summarize&usage=true",
  ]) {
    expect((await router.hono.request(`/${uuid}/inference-status${query}`)).status).toBe(422);
  }
  expect(calls).toHaveLength(0);
  const response = await router.hono.request(`/${uuid}/inference-status?level=vibe&task=summarize`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ...input, revision: 3, message: null, status: "idle" });
  expect(calls).toEqual([{ id: uuid, query: input, actor: owner }]);
});
