import {
  PUSH_TASK_REFS,
  pushOperationResultSchema,
  storeTaskKey,
  type PushOperationResult,
  type PushVibeRequest,
  type SkipReason,
  type TaskInferenceStatusQuery,
} from "@rhizome/store-contract";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { Actor } from "../auth.ts";
import type { BlobStore } from "../blobs/types.ts";
import type { Database } from "../db/index.ts";
import { GRANT_SCOPE } from "../db/models/grant.ts";
import { mediaElements, type DbMediaElement } from "../db/models/media-element.ts";
import { ingestionSources } from "../db/models/ingestion-source.ts";
import { mediaObjectElements } from "../db/models/media-object-element.ts";
import { mediaObjects } from "../db/models/media-object.ts";
import { operations, type DbOperation } from "../db/models/operation.ts";
import { vibeMediaObjects } from "../db/models/vibe-media-object.ts";
import { vibes } from "../db/models/vibe.ts";
import { vibeRevisions } from "../db/models/vibe-revision.ts";
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
import { VibesService } from "../services/vibe-service.ts";
import { batchEnvelope, packChunks, unpackResults } from "./chunking.ts";
import { isDatabaseJson } from "./output-json.ts";
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
import type {
  CompiledImportPushPipeline,
  ImportPushPipelineCatalog,
} from "./import-push-pipeline.ts";
import { validateInstalledTaskOutput } from "./installed-tasks.ts";
import type { PushTaskCatalog, PushTaskDefinition, TaskOutput } from "./task-catalog.ts";
import { summarize } from "./tasks/vibe/summarize/manifest.ts";
import { PushActivity, readObjectInferenceStatus } from "./inference-status.ts";

import { readTaskInferenceStatus } from "./task-inference-status.ts";

type StoredPushRequest = PushVibeRequest & {
  mode: "push";
  vibe: string;
  resolved: { selection: string[]; outcomes_before_run: { preserved_durable: string[] } };
};
type RecordOutcome =
  WriteOutcome | { outcome: "skipped"; reason: SkipReason; code?: ModelConnectorErrorKind };
type VibeOutcome = Extract<PushOperationResult, { level: "vibe" }>["vibe"];
type TerminalStatus = "done" | "failed" | "aborted";

/** Internal conflict context; the public 409 response contains no workset or operation details. */
class ActivePushConflict extends Problem {
  constructor(
    readonly operation: DbOperation,
    readonly selection: readonly string[],
  ) {
    super(
      409,
      "operation_in_progress",
      "Operation in progress",
      "This task is already running on the Vibe",
    );
  }
}

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
  private readonly activity = new PushActivity();
  private readonly pipelines = new Map<string, Promise<Map<string, string>>>();

  getObjectInferenceStatus(uuid: string, actor: Actor) {
    return readObjectInferenceStatus(this.dependencies.db, this.activity, uuid, actor);
  }

  getTaskInferenceStatus(uuid: string, input: TaskInferenceStatusQuery, actor: Actor) {
    return readTaskInferenceStatus(
      this.dependencies.db,
      this.activity,
      this.dependencies.pushTasks,
      uuid,
      input,
      actor,
    );
  }

  constructor(
    private readonly dependencies: {
      db: Database;
      blobs: BlobStore;
      modelConnectors?: ModelConnectorRegistry;
      pushTasks: PushTaskCatalog;
      importPushPipelines: ImportPushPipelineCatalog;
      pushLimits: PushLimits;
    },
  ) {}

  async startPush(vibeUuid: string, input: PushVibeRequest, actor: Actor): Promise<DbOperation> {
    const operation = await this.acceptPush(vibeUuid, input, actor);
    const afterCommit =
      input.level === "object" && input.task === PUSH_TASK_REFS.orbIdentity.name
        ? () => this.refreshVibeOrb(vibeUuid, actor)
        : undefined;
    queueMicrotask(() => {
      void this.runPush(operation.uuid, afterCommit).catch(() =>
        console.error("Push finalization failed", operation.uuid),
      );
    });
    return operation;
  }

  /** Recompose existing object identities after membership changes or a manual identity push. */
  async refreshVibeOrb(vibeUuid: string, actor: Actor): Promise<void> {
    const task = this.dependencies.pushTasks.get("vibe", PUSH_TASK_REFS.vibeOrb.name);
    if (!task || !this.dependencies.modelConnectors) return;
    await this.runAutomaticTask(vibeUuid, actor, task);
  }

  /** Run after import commit; ready tasks accept fresh context after their dependencies settle. */
  async runPushPipeline(
    vibeUuid: string,
    actor: Actor,
    pipeline: CompiledImportPushPipeline,
    objectUris?: readonly string[],
  ): Promise<Map<string, string>> {
    if (!this.dependencies.modelConnectors || !pipeline.nodes.length) return new Map();
    // A second import must wait for the first graph's writes and activity cleanup.
    const previous = this.pipelines.get(vibeUuid) ?? Promise.resolve();
    const run = previous
      .catch(() => {})
      .then(() => this.runPushPipelineNow(vibeUuid, actor, pipeline, objectUris));
    this.pipelines.set(vibeUuid, run);
    try {
      return await run;
    } finally {
      if (this.pipelines.get(vibeUuid) === run) this.pipelines.delete(vibeUuid);
    }
  }

  private async runPushPipelineNow(
    vibeUuid: string,
    actor: Actor,
    pipeline: CompiledImportPushPipeline,
    objectUris?: readonly string[],
  ): Promise<Map<string, string>> {
    const tasks = pipeline.nodes.map(({ task }) => task);
    const operationsByTask = new Map<string, string>();
    this.activity.begin(vibeUuid, tasks, objectUris?.map(uriId));
    try {
      const completions = new Map<string, Promise<void>>();
      for (const node of pipeline.nodes) {
        const dependencies = node.after.map((key) => completions.get(key)!);
        const completion = Promise.allSettled(dependencies).then(async () => {
          const operationUuid = await this.runAutomaticTask(vibeUuid, actor, node.task, objectUris);
          if (operationUuid) operationsByTask.set(node.key, operationUuid);
        });
        completions.set(node.key, completion);
      }
      await Promise.allSettled(completions.values());
      return operationsByTask;
    } finally {
      this.activity.end(vibeUuid);
    }
  }

  async runImportedVibeTasks(
    vibeUuid: string,
    actor: Actor,
    importOperationUuid: string,
    addedObjectUris?: readonly string[],
  ): Promise<void> {
    if (!this.dependencies.modelConnectors) return;
    if (addedObjectUris?.length === 0) return;
    const { db } = this.dependencies;
    const imported = await db.query.operations.findFirst({
      where: eq(operations.uuid, importOperationUuid),
    });
    const request = imported?.request as { mode?: unknown; source?: unknown } | undefined;
    if (request?.mode !== "import_preview" || typeof request.source !== "string") {
      throw new Error("Automatic import push requires its import preview source");
    }
    const sourceUuid = request.source.startsWith("source:")
      ? request.source.slice("source:".length)
      : undefined;
    if (!sourceUuid) throw new Error("Automatic import push source is malformed");
    const source = await db.query.ingestionSources.findFirst({
      where: eq(ingestionSources.uuid, sourceUuid),
    });
    if (!source) throw new Error("Automatic import push source disappeared");
    const pipeline = this.dependencies.importPushPipelines.forSkillId(source.skillId);
    if (!pipeline) {
      throw new Error(`Source-skill ${source.skillId} has no compiled import push pipeline`);
    }
    const operationsByTask = await this.runPushPipeline(vibeUuid, actor, pipeline, addedObjectUris);
    // Existing Vibe imports enrich their additions without changing the owner's title.
    if (addedObjectUris) return;

    if (!imported?.result || imported.result.destination) return;

    const summaryOperation = operationsByTask.get(`vibe:${summarize.name}`);
    if (!summaryOperation) return;
    const confirmed = await db.query.vibeRevisions.findFirst({
      where: and(eq(vibeRevisions.vibeUuid, vibeUuid), eq(vibeRevisions.rev, 1)),
    });
    const expectedTitle = confirmed?.snapshot.title;
    // Only the host's unnamed-import placeholder is eligible for automatic naming.
    if (expectedTitle !== "Imported objects") return;
    const summary = await db.query.vibeRevisions.findFirst({
      where: and(
        eq(vibeRevisions.vibeUuid, vibeUuid),
        eq(vibeRevisions.operationUuid, summaryOperation),
      ),
    });
    const inferred = summary?.snapshot.inferred as typeof vibes.$inferSelect.inferred | undefined;
    const title = inferred?.[storeTaskKey(summarize.name)]?.properties.title;
    if (typeof title !== "string") return;
    // Import naming is an owner action; the push writer still changes only inferred data.
    await new VibesService({ db, actor }).renameVibeIfTitle(vibeUuid, expectedTitle, title);
  }

  private async runAutomaticTask(
    vibeUuid: string,
    actor: Actor,
    task: PushTaskDefinition,
    objectUris?: readonly string[],
  ): Promise<string | undefined> {
    const level = task.level;
    try {
      let input: PushVibeRequest = { level, task: task.name };
      if (objectUris && level !== "vibe") {
        const selection =
          level === "object"
            ? [...objectUris]
            : (await loadContextObjects(this.dependencies.db, objectUris.map(uriId))).flatMap(
                ({ elements }) =>
                  elements
                    .filter(({ element }) => task.elementKinds?.includes(element.kind))
                    .map(({ element }) => `rnet://element/${element.uuid}`),
              );
        if (!selection.length) {
          this.activity.accepted(vibeUuid, task);
          return;
        }
        input = { level, task: task.name, selection: [...new Set(selection)] };
      }
      let operation: DbOperation | undefined;
      for (;;) {
        try {
          operation = await this.acceptPush(vibeUuid, input, actor, true);
          break;
        } catch (error) {
          if (!(error instanceof ActivePushConflict)) throw error;
          // Keep this node pending and its dependents blocked until the conflicting work settles.
          const completed = await this.waitForConflictingPush(error.operation);
          const result = completed.result as PushOperationResult | null;
          if (level === "vibe") {
            const previous = completed.request as StoredPushRequest;
            if (
              result?.level === "vibe" &&
              (result.vibe.outcome !== "skipped" || result.vibe.reason === "preserved_durable") &&
              error.selection.every((uuid) => previous.resolved.selection.includes(uuid))
            ) {
              this.activity.accepted(vibeUuid, task);
              // This was another run's summary, so it must not drive automatic import naming.
              return;
            }
          } else {
            const covered = new Set(
              result && result.level === level
                ? [
                    ...result.written.map(({ uri }) => uri),
                    ...result.preserved,
                    ...result.skipped
                      .filter(({ reason }) =>
                        ["not_applicable", "preserved_durable"].includes(reason),
                      )
                      .map(({ uri }) => uri),
                  ].map(uriId)
                : [],
            );
            const remaining = error.selection.filter((uuid) => !covered.has(uuid));
            if (!remaining.length) {
              this.activity.accepted(vibeUuid, task);
              return;
            }
            input = {
              level,
              task: task.name,
              selection: remaining.map((uuid) => `rnet://${level}/${uuid}`),
            };
          }
          // Reaccept after waiting: permissions, live membership, and durable writes are checked again.
        }
      }
      this.activity.accepted(vibeUuid, task);
      if (!operation) return;
      await this.runPush(operation.uuid);
      return operation.uuid;
    } catch (error) {
      this.activity.rejected(vibeUuid, task, error);
      // Import enrichment is best effort: settled dependencies unblock all remaining nodes.
      console.error(
        "Automatic push failed",
        vibeUuid,
        level,
        task.name,
        error instanceof Problem ? error.code : "internal_error",
      );
    }
  }

  private async waitForConflictingPush(operation: DbOperation): Promise<DbOperation> {
    const deadline =
      operation.createdAt.getTime() + this.dependencies.pushLimits.maxWallMs + 60_000;
    for (;;) {
      const current = await this.dependencies.db.query.operations.findFirst({
        where: eq(operations.uuid, operation.uuid),
      });
      if (!current || current.vibeUuid !== operation.vibeUuid) throw notFound("Operation");
      if (!["queued", "running"].includes(current.status)) return current;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        // This process is the sole runner. The wall deadline plus finalization grace has
        // elapsed; retire the stranded row without overwriting a concurrent terminal result.
        const [interrupted] = await this.dependencies.db
          .update(operations)
          .set({ status: "failed", error: "interrupted", finishedAt: new Date() })
          .where(
            and(
              eq(operations.uuid, operation.uuid),
              eq(operations.vibeUuid, operation.vibeUuid!),
              inArray(operations.status, ["queued", "running"]),
            ),
          )
          .returning({ uuid: operations.uuid });
        if (!interrupted) continue;
        throw new Problem(
          503,
          "push_unavailable",
          "Push unavailable",
          "The running inference task did not finish; automatic enrichment could not continue.",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(250, remaining)));
    }
  }

  private acceptPush(vibeUuid: string, input: PushVibeRequest, actor: Actor): Promise<DbOperation>;
  private acceptPush(
    vibeUuid: string,
    input: PushVibeRequest,
    actor: Actor,
    automatic: true,
  ): Promise<DbOperation | undefined>;
  private async acceptPush(
    vibeUuid: string,
    input: PushVibeRequest,
    actor: Actor,
    automatic = false,
  ): Promise<DbOperation | undefined> {
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
      selection = input.selection.flatMap((uri, index) => {
        const uuid = uriId(uri);
        if (!eligible.includes(uuid)) {
          // Automatic graphs keep their original additions, but membership and liveness may
          // change while a dependency or another run is in flight. Keep eligible siblings.
          if (automatic) return [];
          throw schemaProblem([
            {
              instancePath: `/selection/${index}`,
              message: "is not a member at the task's level and kind",
            },
          ]);
        }
        return [uuid];
      });
    selection = [...new Set(selection)];
    if (automatic && input.level !== "vibe" && !selection.length) return;
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
        .select()
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
      if (active[0]) throw new ActivePushConflict(active[0], selection);
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
  async runPush(operationUuid: string, afterCommit?: () => Promise<void>): Promise<void> {
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
    this.activity.settled.set(operationUuid, state.outcomes);
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
          const taskContext = await task.prepareVibeContext?.({
            vibeUuid,
            records,
            blobs: this.dependencies.blobs,
            signal: controller.signal,
          });
          const context = assembleVibeContext(records, vibe, task, taskContext);
          state.context = context.context;
          let output = task.rules?.(context.vibe);
          if (output !== undefined) state.producer = `${STORE_ACTOR}/${task.name}-rules@1`;
          else if (!stopForCeiling()) {
            const assembled = await assembleVibeInput(
              records,
              vibe,
              task,
              registry,
              limits,
              context,
            );
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
            output = task.transformVibeOutput?.(output, context.vibe) ?? output;
            if (
              !jsonSchema(task.outputSchema).validate(output).ok ||
              task.validateOutput?.(output) === false ||
              !isDatabaseJson(output) ||
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
            const elements = await loadElements(db, pending);
            const liveIds = new Set(elements.map((element) => element.uuid));
            for (const uuid of pending)
              if (!liveIds.has(uuid)) state.outcomes.set(uuid, { outcome: "not_applicable" });
            for (const candidate of elements) {
              if (controller.signal.aborted) {
                stopForCeiling();
                return;
              }
              // Earlier batches may have waited on providers since the initial workset load.
              // Check the tombstone immediately before preparing each new payload.
              const [element] = await loadElements(db, [candidate.uuid]);
              if (!element) {
                state.outcomes.set(candidate.uuid, { outcome: "not_applicable" });
                continue;
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
              const payload = await blobs.get("elements", element.contentHash, controller.signal);
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
            if (
              !isDatabaseJson(output) ||
              (output !== null && task.validateOutput?.(output) === false)
            ) {
              state.outcomes.set(record.uuid, { outcome: "skipped", reason: "invalid_output" });
              continue;
            }
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
    } catch (error) {
      console.error("Push execution failed", {
        operationUuid,
        kind: error instanceof ModelConnectorError ? error.kind : "internal_error",
      });
      if (controller.signal.aborted) stopForCeiling();
      else {
        state.status = "failed";
        state.abortReason = null;
        state.error = "The push operation could not complete.";
      }
    } finally {
      clearTimeout(wallTimer);
      if (state.committed && afterCommit) {
        try {
          await afterCommit();
        } catch {
          console.error("Derived orb refresh failed", operationUuid);
        }
      }
      this.activity.calls.delete(operationUuid);
      this.activity.settled.delete(operationUuid);
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
    this.activity.calls.set(operationUuid, new Set(uuids));
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
    this.activity.calls.delete(operationUuid);
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
      >`coalesce(jsonb_agg(jsonb_build_object('element', jsonb_build_object('uuid', ${mediaElements.uuid}, 'kind', ${mediaElements.kind}, 'mime', ${mediaElements.mime}, 'alt', ${mediaElements.alt}, 'inferred', ${mediaElements.inferred}, 'contentHash', ${mediaElements.contentHash}, 'byteSize', ${mediaElements.byteSize})) || case when ${mediaObjectElements.role} is null then '{}'::jsonb else jsonb_build_object('role', ${mediaObjectElements.role}) end order by ${mediaObjectElements.position}) filter (where ${mediaElements.uuid} is not null), '[]'::jsonb)`,
    })
    .from(mediaObjects)
    .leftJoin(mediaObjectElements, eq(mediaObjectElements.mediaObjectUuid, mediaObjects.uuid))
    .leftJoin(
      mediaElements,
      and(
        eq(mediaElements.uuid, mediaObjectElements.mediaElementUuid),
        isNull(mediaElements.tombstonedAt),
      ),
    )
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
    .where(and(inArray(mediaElements.uuid, [...uuids]), isNull(mediaElements.tombstonedAt)));
  const byId = new Map(rows.map((row) => [row.uuid, row]));
  return uuids.flatMap((uuid) => {
    const record = byId.get(uuid);
    return record ? [record] : [];
  });
}
