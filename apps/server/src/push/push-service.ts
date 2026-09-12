import {
  pushOperationResultSchema,
  storeTaskKey,
  type PushOperationResult,
  type PushVibeRequest,
  type SkipReason,
} from "@rhizome/store-contract";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { Actor } from "../auth.ts";
import type { BlobStore } from "../blobs/types.ts";
import type { Database } from "../db/index.ts";
import { GRANT_SCOPE } from "../db/models/grant.ts";
import { mediaElements, type DbMediaElement } from "../db/models/media-element.ts";
import { mediaObjectElements } from "../db/models/media-object-element.ts";
import { mediaObjects } from "../db/models/media-object.ts";
import { operations, type DbOperation } from "../db/models/operation.ts";
import { vibeMediaObjects } from "../db/models/vibe-media-object.ts";
import { vibes } from "../db/models/vibe.ts";
import { notFound, Problem } from "../errors.ts";
import type { ModelConnectorRegistry } from "../inference/connector-registry.ts";
import {
  ModelConnectorError,
  type CompletionRequest,
  type CompletionResult,
  type ModelConnectorErrorKind,
} from "../inference/model-connector.ts";
import { assertStructuredOutputSchema } from "../inference/structured-output-schema.ts";
import { imageDimensions } from "../inference/image.ts";
import { MeterLedger } from "../metering/meter-ledger.ts";
import { STORE_ACTOR } from "../rnet.ts";
import { jsonSchema } from "../routes/contracts.ts";
import { AccessService } from "../services/access-service.ts";
import {
  writeObjectTaskInferred,
  writeElementTaskInferred,
  writeVibeTaskInferred,
  type InferredEntry,
  type WriteOutcome,
} from "../services/inferred-writer.ts";
import { schemaProblem } from "../services/problems.ts";
import { uriId } from "../services/uris.ts";
import { batchEnvelope, packChunks, unpackResults } from "./chunking.ts";
import {
  assembleObjectContext,
  assembleElementContext,
  assembleVibeContext,
  assembleVibeInput,
  dataBlock,
  emptyContextCounts,
  type ContextObject,
  type ContextCounts,
} from "./context.ts";
import type { PushLimits } from "./limits.ts";
import { validateInstalledTaskOutput } from "./installed-tasks.ts";
import type { PushTaskCatalog, PushTaskDefinition, TaskOutput } from "./task-catalog.ts";

type StoredPushRequest = PushVibeRequest & {
  mode: "push";
  vibe: string;
  resolved: { selection: string[]; outcomes_before_run: { preserved_durable: string[] } };
};
type RecordOutcome =
  WriteOutcome | { outcome: "skipped"; reason: SkipReason; code?: ModelConnectorErrorKind };
type VibeOutcome = Extract<PushOperationResult, { level: "vibe" }>["vibe"];
type TerminalStatus = "done" | "failed" | "aborted";
interface RunState {
  request: StoredPushRequest;
  outcomes: Map<string, RecordOutcome>;
  vibe?: VibeOutcome;
  producer: string | null;
  calls: number;
  context: ContextCounts;
  abortReason: PushOperationResult["abort_reason"];
  status: TerminalStatus;
  error: string | null;
  committed: boolean;
}

export class PushService {
  constructor(
    private readonly dependencies: {
      db: Database;
      blobs: BlobStore;
      modelConnectors?: ModelConnectorRegistry;
      pushTasks: PushTaskCatalog;
      pushLimits: PushLimits;
    },
  ) {}

  async startPush(vibeUuid: string, input: PushVibeRequest, actor: Actor): Promise<DbOperation> {
    const operation = await this.acceptPush(vibeUuid, input, actor);
    queueMicrotask(() => {
      void this.runPush(operation.uuid).catch(() =>
        console.error("Push finalization failed", operation.uuid),
      );
    });
    return operation;
  }

  /** Run after import commit; each task accepts fresh context only when its turn begins. */
  async runAllTasks(vibeUuid: string, actor: Actor): Promise<void> {
    if (!this.dependencies.modelConnectors) return;
    const tasks = this.dependencies.pushTasks.manifests();
    // Preserve catalog order within each level (including summary before view).
    for (const level of ["element", "object", "vibe"] as const) {
      for (const task of tasks.filter((task) => task.level === level)) {
        try {
          const operation = await this.acceptPush(vibeUuid, { level, task: task.name }, actor);
          await this.runPush(operation.uuid);
        } catch (error) {
          // A task's acceptance/finalization failure must not prevent the other tasks from running.
          console.error(
            "Automatic push failed",
            vibeUuid,
            level,
            task.name,
            error instanceof Problem ? error.code : "internal_error",
          );
        }
      }
    }
  }

  async runImportedVibeTasks(vibeUuid: string, actor: Actor): Promise<void> {
    if (!this.dependencies.modelConnectors) return;
    // The owner's automatic-ingest policy excludes any Vibe containing transactions.
    // Manual pushes retain the task catalog's shape-based applicability rules.
    const [transaction] = await this.dependencies.db
      .select({ uuid: mediaObjects.uuid })
      .from(vibeMediaObjects)
      .innerJoin(mediaObjects, eq(mediaObjects.uuid, vibeMediaObjects.mediaObjectUuid))
      .where(and(eq(vibeMediaObjects.vibeUuid, vibeUuid), eq(mediaObjects.type, "transaction")))
      .limit(1);
    if (transaction) return;
    await this.runAllTasks(vibeUuid, actor);
  }

  private async acceptPush(
    vibeUuid: string,
    input: PushVibeRequest,
    actor: Actor,
  ): Promise<DbOperation> {
    const { db, modelConnectors: registry, pushTasks, pushLimits: limits } = this.dependencies;
    const vibe = await new AccessService({ db, actor }).assertVibeScope(vibeUuid, GRANT_SCOPE.PUSH);
    const task = pushTasks.get(input.level, input.task);
    if (!task)
      throw schemaProblem([
        { instancePath: "/task", message: "is not an installed task at this level" },
      ]);
    if (!registry)
      throw new Problem(
        503,
        "push_unavailable",
        "Push unavailable",
        "No inference provider is configured",
      );
    const placements = await db
      .select({ uuid: vibeMediaObjects.mediaObjectUuid })
      .from(vibeMediaObjects)
      .where(eq(vibeMediaObjects.vibeUuid, vibeUuid))
      .orderBy(asc(vibeMediaObjects.position));
    const memberIds = [...new Set(placements.map(({ uuid }) => uuid))];
    const members = await loadContextObjects(db, memberIds);
    const key = storeTaskKey(task.name);
    const reachableElements = new Map<string, ContextObject["elements"][number]["element"]>();
    for (const record of members)
      for (const { element } of record.elements)
        if (task.elementKinds?.includes(element.kind) && !reachableElements.has(element.uuid))
          reachableElements.set(element.uuid, element);
    const eligible = input.level === "element" ? [...reachableElements.keys()] : memberIds;
    let selection = eligible;
    if (input.level !== "vibe" && input.selection)
      selection = input.selection.map((uri, index) => {
        const uuid = uriId(uri);
        if (!eligible.includes(uuid))
          throw schemaProblem([
            {
              instancePath: `/selection/${index}`,
              message: "is not a member at the task's level and kind",
            },
          ]);
        return uuid;
      });
    selection = [...new Set(selection)];
    if (
      (input.level === "object" && selection.length > limits.maxObjects) ||
      (input.level === "element" && selection.length > limits.maxElements)
    )
      throw schemaProblem([
        { instancePath: "/selection", message: "exceeds the push workset limit" },
      ]);
    const objectsById = new Map(members.map((record) => [record.object.uuid, record.object]));
    const preserved =
      input.level === "vibe"
        ? vibe.inferred[key]?.durable === true
          ? [vibe.uuid]
          : []
        : selection.filter(
            (uuid) =>
              (input.level === "element" ? reachableElements.get(uuid) : objectsById.get(uuid))
                ?.inferred[key]?.durable === true,
          );
    const request: StoredPushRequest = {
      ...input,
      mode: "push",
      vibe: `rnet://vibe/${vibeUuid}`,
      resolved: { selection, outcomes_before_run: { preserved_durable: preserved } },
    };
    const operationUuid = uuidv7();
    const operation = await db.transaction(async (transaction) => {
      const [locked] = await transaction
        .select()
        .from(vibes)
        .where(eq(vibes.uuid, vibeUuid))
        .for("update");
      if (!locked) throw notFound("Vibe");
      const active = await transaction
        .select({ uuid: operations.uuid })
        .from(operations)
        .where(
          and(
            eq(operations.vibeUuid, vibeUuid),
            eq(operations.kind, "push"),
            inArray(operations.status, ["queued", "running"]),
            sql`${operations.request}->>'level' = ${input.level}`,
            sql`${operations.request}->>'task' = ${input.task}`,
            gt(operations.createdAt, new Date(Date.now() - limits.maxWallMs - 60_000)),
          ),
        )
        .limit(1);
      if (active.length)
        throw new Problem(
          409,
          "operation_in_progress",
          "Operation in progress",
          "This task is already running on the Vibe",
        );
      const [created] = await transaction
        .insert(operations)
        .values({
          uuid: operationUuid,
          kind: "push",
          status: "queued",
          invokedBy: actor.subject,
          ownerUuid: vibe.ownerUuid,
          vibeUuid,
          request,
        })
        .returning();
      await MeterLedger.open(transaction, registry, operationUuid, task.name, actor.subject);
      return created!;
    });
    return operation;
  }

  /** Rehydrates exclusively from the operation row; no accept-time record snapshot is captured. */
  async runPush(operationUuid: string): Promise<void> {
    const { db, modelConnectors: registry, pushTasks, pushLimits: limits } = this.dependencies;
    const [operation] = await db
      .update(operations)
      .set({ status: "running" })
      .where(and(eq(operations.uuid, operationUuid), eq(operations.status, "queued")))
      .returning();
    if (!operation) return;
    if (!registry) throw new Error("Push registry disappeared");
    const request = operation.request as StoredPushRequest;
    const ledger = await MeterLedger.load(db, operationUuid, registry);
    const state: RunState = {
      request,
      outcomes: new Map(),
      producer: null,
      calls: 0,
      context: emptyContextCounts(),
      abortReason: null,
      status: "done",
      error: null,
      committed: false,
    };
    const key = storeTaskKey(request.task);
    for (const uuid of request.resolved.outcomes_before_run.preserved_durable)
      state.outcomes.set(uuid, { outcome: "preserved_durable" });
    if (request.level === "vibe" && state.outcomes.size)
      state.vibe = { outcome: "preserved_durable", key };
    const controller = new AbortController();
    const wallRemaining = limits.maxWallMs - (Date.now() - operation.createdAt.getTime());
    const wallTimer = setTimeout(() => controller.abort(), Math.max(0, wallRemaining));
    if (wallRemaining <= 0) controller.abort();
    const stopForCeiling = () => {
      const usage = ledger.usage;
      state.abortReason = controller.signal.aborted
        ? "max_wall"
        : state.calls >= limits.maxCalls
          ? "max_turns"
          : usage.tokens_in + usage.tokens_out >= limits.maxTokens
            ? "max_tokens"
            : null;
      if (state.abortReason) state.status = "aborted";
      return state.abortReason !== null;
    };
    try {
      const task = pushTasks.get(request.level, request.task);
      if (!task) throw new Error("Push task disappeared");
      const vibeUuid = uriId(request.vibe);
      const vibe = await db.query.vibes.findFirst({ where: eq(vibes.uuid, vibeUuid) });
      if (!vibe) throw new Error("Push Vibe disappeared");
      if (request.level === "vibe") {
        if (!state.vibe) {
          const records = await loadContextObjects(db, request.resolved.selection);
          const context = assembleVibeContext(records, vibe, task);
          state.context = context.context;
          let output = task.rules?.(context.vibe);
          if (output !== undefined) state.producer = `${STORE_ACTOR}/${task.name}-rules@1`;
          else if (!stopForCeiling()) {
            const assembled = await assembleVibeInput(records, vibe, task, registry, limits);
            state.context = assembled.context;
            if (assembled.input === null)
              state.vibe = { outcome: "skipped", reason: "context_too_large" };
            else if (!stopForCeiling()) {
              const result = await this.complete(
                task,
                assembled.input,
                task.outputSchema,
                1,
                operationUuid,
                state,
                ledger,
                controller.signal,
              );
              if (result) output = result.output as TaskOutput;
            }
          }
          if (output !== undefined) {
            if (
              !jsonSchema(task.outputSchema).validate(output).ok ||
              !validateInstalledTaskOutput(task, output, context.vibe)
            )
              state.vibe = { outcome: "skipped", reason: "invalid_output" };
            else if (controller.signal.aborted) {
              state.abortReason = "max_wall";
              state.status = "aborted";
            } else {
              const written = await writeVibeTaskInferred(db, {
                vibeUuid,
                task: task.name,
                entry: toEntry(output, state.producer!),
                operationUuid,
              });
              if (written.outcome === "written") {
                state.vibe = { outcome: "written", key, rev: written.rev };
                state.committed = true;
              } else state.vibe = { outcome: "skipped", reason: "preserved_durable" };
            }
          }
        }
      } else {
        const pending = request.resolved.selection.filter((uuid) => !state.outcomes.has(uuid));
        type Prepared = {
          uuid: string;
          data: Record<string, unknown>;
          clipped: boolean;
          attachment?: { mime: string; bytes: Uint8Array };
        };
        const { blobs } = this.dependencies;
        const prepare = async function* (): AsyncGenerator<Prepared> {
          if (request.level === "object") {
            for (const record of await loadContextObjects(db, pending)) {
              const context = assembleObjectContext(record, task);
              if (context.clipped) state.context.clipped_objects++;
              yield { uuid: record.object.uuid, ...context };
            }
          } else {
            for (const element of await loadElements(db, pending)) {
              if (controller.signal.aborted) {
                stopForCeiling();
                return;
              }
              if (
                element.byteSize > limits.maxAttachmentBytes ||
                !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(element.mime)
              ) {
                state.outcomes.set(element.uuid, {
                  outcome: "skipped",
                  reason: "unsupported_media",
                });
                continue;
              }
              const payload = await blobs.get("elements", element.contentHash);
              if (!payload) throw new Error("Push image payload disappeared");
              if (
                payload.bytes.byteLength > limits.maxAttachmentBytes ||
                !imageDimensions(element.mime, payload.bytes)
              ) {
                state.outcomes.set(element.uuid, {
                  outcome: "skipped",
                  reason: "unsupported_media",
                });
                continue;
              }
              yield {
                uuid: element.uuid,
                data: assembleElementContext(element),
                clipped: false,
                attachment: { mime: element.mime, bytes: payload.bytes },
              };
            }
          }
        };
        const prefix = request.level === "object" ? "o" : "e";
        const attachmentsFor = (records: readonly Prepared[]) =>
          records.flatMap((record, index) =>
            record.attachment ? [{ ref: `${prefix}${index + 1}`, ...record.attachment }] : [],
          );
        const inputFor = (records: readonly Prepared[]) =>
          dataBlock({
            [request.level === "object" ? "objects" : "elements"]: records.map((record, index) => ({
              ref: `${prefix}${index + 1}`,
              ...record.data,
            })),
            context: {
              ...emptyContextCounts(),
              clipped_objects: records.filter((record) => record.clipped).length,
            },
          });
        const packed = packChunks(
          prepare(),
          task,
          registry,
          limits,
          inputFor,
          (record) =>
            state.outcomes.set(record.uuid, { outcome: "skipped", reason: "context_too_large" }),
          attachmentsFor,
        );
        for await (const chunk of packed) {
          if (stopForCeiling()) break;
          const refs = chunk.map((_, index) => `${prefix}${index + 1}`);
          const result = await this.complete(
            task,
            inputFor(chunk),
            batchEnvelope(task.outputSchema, refs),
            chunk.length,
            operationUuid,
            state,
            ledger,
            controller.signal,
            chunk.map((record) => record.uuid),
            attachmentsFor(chunk),
          );
          if (state.status !== "done") break;
          if (!result) continue;
          let outputs: Array<TaskOutput | null>;
          try {
            outputs = unpackResults(task.outputSchema, refs, result.output);
          } catch {
            for (const record of chunk)
              state.outcomes.set(record.uuid, { outcome: "skipped", reason: "invalid_output" });
            continue;
          }
          for (const [index, record] of chunk.entries()) {
            if (controller.signal.aborted) {
              state.abortReason = "max_wall";
              state.status = "aborted";
              break;
            }
            const output = outputs[index]!;
            const input = {
              task: task.name,
              entry: output === null ? null : toEntry(output, state.producer!),
              operationUuid,
            };
            const outcome =
              request.level === "object"
                ? await writeObjectTaskInferred(db, { ...input, mediaObjectUuid: record.uuid })
                : await writeElementTaskInferred(db, { ...input, mediaElementUuid: record.uuid });
            state.outcomes.set(
              record.uuid,
              outcome.outcome === "preserved_durable"
                ? { outcome: "skipped", reason: "preserved_durable" }
                : outcome,
            );
            if (outcome.outcome === "written" || outcome.outcome === "removed")
              state.committed = true;
          }
          if (state.status !== "done") break;
        }
      }
    } catch {
      state.status = "failed";
      state.abortReason = null;
      state.error = "The push operation could not complete.";
    } finally {
      clearTimeout(wallTimer);
      await finalizePush(db, {
        operationUuid,
        ledger,
        status: state.status,
        result: buildResult(state, ledger),
        error: state.error,
        committed: state.committed,
        createdAt: operation.createdAt,
      });
    }
  }

  private async complete(
    task: PushTaskDefinition,
    input: string,
    schema: CompletionRequest["schema"],
    count: number,
    operationUuid: string,
    state: RunState,
    ledger: MeterLedger,
    signal: AbortSignal,
    uuids: string[] = [],
    attachments?: CompletionRequest["attachments"],
  ): Promise<CompletionResult | undefined> {
    const registry = this.dependencies.modelConnectors!;
    assertStructuredOutputSchema(schema);
    state.calls++;
    state.producer = registry.identity;
    let result: CompletionResult | undefined;
    let failure: unknown;
    // The boundary only captures a result/error. Its usage is the first thing handled afterward.
    try {
      result = await registry.connector.complete({
        target: registry.target,
        instructions: task.prompt,
        input,
        ...(attachments?.length ? { attachments } : {}),
        schema,
        schemaName: `rhizome_${task.name}`,
        effort: task.effort,
        maxOutputTokens: task.outputTokens.base + task.outputTokens.perObject * count,
        timeoutMs: 600_000,
        signal,
        trace: { operationUuid, call: state.calls },
      });
    } catch (error) {
      failure = error;
    }
    const usage =
      result?.usage ?? (failure instanceof ModelConnectorError ? failure.usage : undefined);
    if (usage)
      await ledger.record(usage, {
        index: state.calls,
        objects: count,
        outcome: failure instanceof ModelConnectorError ? failure.kind : "completed",
      });
    if (result) return result;
    if (!(failure instanceof ModelConnectorError)) throw failure;
    if (failure.kind === "aborted") {
      state.abortReason = "max_wall";
      state.status = "aborted";
      return;
    }
    const outcome = { outcome: "skipped", reason: "call_failed", code: failure.kind } as const;
    if (task.level === "vibe") state.vibe = outcome;
    else for (const uuid of uuids) state.outcomes.set(uuid, outcome);
    if (failure.kind === "auth" || failure.kind === "invalid_request") {
      state.status = "failed";
      state.error = "The push operation could not complete.";
    }
  }
}

function buildResult(state: RunState, ledger: MeterLedger): PushOperationResult {
  const shared = {
    task: state.request.task,
    model: state.producer,
    llm_calls: ledger.turns,
    usage: ledger.usage,
    context: state.context,
    abort_reason: state.abortReason,
  };
  const key = storeTaskKey(state.request.task);
  if (state.request.level === "vibe")
    return {
      ...shared,
      level: "vibe",
      vibe: state.vibe ?? { outcome: "skipped", reason: "aborted" },
    };
  const level = state.request.level;
  const written: Array<{ uri: string; key: typeof key; rev: number }> = [];
  const preserved: string[] = [];
  const skipped: Array<{
    uri: string;
    reason: SkipReason;
    code?: ModelConnectorErrorKind;
    removed?: true;
  }> = [];
  let removed = 0,
    failed = 0;
  for (const uuid of state.request.resolved.selection) {
    const uri = `rnet://${level}/${uuid}`;
    const outcome: RecordOutcome =
      state.outcomes.get(uuid) ?? ({ outcome: "skipped", reason: "aborted" } as const);
    if (outcome.outcome === "written") written.push({ uri, key, rev: outcome.rev });
    else if (outcome.outcome === "preserved_durable") preserved.push(uri);
    else if (outcome.outcome === "removed") {
      skipped.push({ uri, reason: "not_applicable", removed: true });
      removed++;
    } else if (outcome.outcome === "not_applicable")
      skipped.push({ uri, reason: "not_applicable" });
    else {
      skipped.push({
        uri,
        reason: outcome.reason,
        ...(outcome.code ? { code: outcome.code } : {}),
      });
      if (outcome.reason === "call_failed") failed++;
    }
  }
  const tally = {
    selected: state.request.resolved.selection.length,
    sent: state.request.resolved.selection.length - preserved.length,
    written: written.length,
    removed,
    preserved_durable: preserved.length,
    skipped: skipped.length - removed - failed,
    failed,
  };
  return (
    level === "object"
      ? { ...shared, level, objects: tally, written, preserved, skipped }
      : { ...shared, level, elements: tally, written, preserved, skipped }
  ) as PushOperationResult;
}

/** Validate before beginning the terminal transaction; close the meter atomically with the operation. */
export async function finalizePush(
  db: Database,
  input: {
    operationUuid: string;
    ledger: MeterLedger;
    status: TerminalStatus;
    result: unknown;
    error: string | null;
    committed: boolean;
    createdAt: Date;
  },
): Promise<void> {
  const validation = jsonSchema(pushOperationResultSchema).validate(input.result);
  const status = validation.ok ? input.status : "failed";
  const result = validation.ok ? validation.value : null;
  const finishedAt = new Date();
  await db.transaction(async (transaction) => {
    const updated = await transaction
      .update(operations)
      .set({
        status,
        result,
        error: validation.ok ? input.error : "The push operation could not complete.",
        finishedAt,
        committedAt: input.committed ? finishedAt : null,
      })
      .where(and(eq(operations.uuid, input.operationUuid), eq(operations.status, "running")))
      .returning({ uuid: operations.uuid });
    if (updated.length)
      await input.ledger.close(
        transaction,
        status,
        Math.max(0, finishedAt.getTime() - input.createdAt.getTime()),
        result?.abort_reason ?? null,
      );
  });
}

function toEntry(output: TaskOutput, model: string): InferredEntry {
  const { confidence, ...properties } = output;
  return {
    model,
    inferred_at: new Date().toISOString(),
    ...(typeof confidence === "number" ? { confidence } : {}),
    properties,
  };
}

async function loadContextObjects(
  db: Database,
  uuids: readonly string[],
): Promise<ContextObject[]> {
  if (!uuids.length) return [];
  // One grouped query loads the live members and ordered element metadata for shape unions.
  const rows = await db
    .select({
      object: mediaObjects,
      elements: sql<
        ContextObject["elements"]
      >`coalesce(jsonb_agg(jsonb_build_object('element', jsonb_build_object('uuid', ${mediaElements.uuid}, 'kind', ${mediaElements.kind}, 'mime', ${mediaElements.mime}, 'alt', ${mediaElements.alt}, 'inferred', ${mediaElements.inferred})) || case when ${mediaObjectElements.role} is null then '{}'::jsonb else jsonb_build_object('role', ${mediaObjectElements.role}) end order by ${mediaObjectElements.position}) filter (where ${mediaElements.uuid} is not null), '[]'::jsonb)`,
    })
    .from(mediaObjects)
    .leftJoin(mediaObjectElements, eq(mediaObjectElements.mediaObjectUuid, mediaObjects.uuid))
    .leftJoin(mediaElements, eq(mediaElements.uuid, mediaObjectElements.mediaElementUuid))
    .where(inArray(mediaObjects.uuid, [...uuids]))
    .groupBy(mediaObjects.uuid);
  const byId = new Map(rows.map((row) => [row.object.uuid, row]));
  return uuids.map((uuid) => {
    const record = byId.get(uuid);
    if (!record) throw new Error("Push object disappeared");
    return record;
  });
}
async function loadElements(db: Database, uuids: readonly string[]): Promise<DbMediaElement[]> {
  if (!uuids.length) return [];
  const rows = await db
    .select()
    .from(mediaElements)
    .where(inArray(mediaElements.uuid, [...uuids]));
  const byId = new Map(rows.map((row) => [row.uuid, row]));
  return uuids.map((uuid) => {
    const record = byId.get(uuid);
    if (!record) throw new Error("Push element disappeared");
    return record;
  });
}
