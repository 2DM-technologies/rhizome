import {
  storeTaskKey,
  type InferenceTaskStatus,
  type ObjectInferenceStatus,
  type PushOperationResult,
} from "@rhizome/store-contract";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Actor } from "../auth.ts";
import type { Database } from "../db/index.ts";
import { GRANT_SCOPE } from "../db/models/grant.ts";
import { mediaElements } from "../db/models/media-element.ts";
import { mediaObjectElements } from "../db/models/media-object-element.ts";
import { operations, type DbOperation } from "../db/models/operation.ts";
import { vibeMediaObjects } from "../db/models/vibe-media-object.ts";
import { Problem } from "../errors.ts";
import { AccessService } from "../services/access-service.ts";
import type { PushTaskDefinition } from "./task-catalog.ts";

type PendingTask = Pick<PushTaskDefinition, "level" | "name" | "elementKinds"> & {
  message: string | null;
  objectUuids?: readonly string[];
  failedAt?: Date;
};

/** Process-local display state only; it neither accepts work nor resumes it after restart. */
export class PushActivity {
  readonly pending = new Map<string, Map<string, PendingTask>>();
  readonly calls = new Map<string, ReadonlySet<string>>();
  private readonly batches = new Map<string, Map<number, readonly string[]>>();

  startBatch(operationUuid: string, index: number, uuids: readonly string[]) {
    const batches = this.batches.get(operationUuid) ?? new Map<number, readonly string[]>();
    batches.set(index, uuids);
    this.batches.set(operationUuid, batches);
    this.calls.set(operationUuid, new Set([...batches.values()].flat()));
  }

  finishBatch(operationUuid: string, index: number) {
    const batches = this.batches.get(operationUuid);
    batches?.delete(index);
    this.calls.set(operationUuid, new Set([...(batches?.values() ?? [])].flat()));
  }

  finishOperation(operationUuid: string) {
    this.batches.delete(operationUuid);
    this.calls.delete(operationUuid);
    this.settled.delete(operationUuid);
  }
  readonly settled = new Map<string, ReadonlyMap<string, unknown>>();

  begin(vibeUuid: string, tasks: readonly PushTaskDefinition[], objectUuids?: readonly string[]) {
    this.pending.set(
      vibeUuid,
      new Map(
        tasks.map((task) => [
          `${task.level}:${task.name}`,
          {
            level: task.level,
            name: task.name,
            elementKinds: task.elementKinds,
            message: null,
            objectUuids,
          },
        ]),
      ),
    );
  }
  accepted(vibeUuid: string, task: Pick<PushTaskDefinition, "level" | "name">) {
    this.pending.get(vibeUuid)?.delete(`${task.level}:${task.name}`);
  }
  rejected(vibeUuid: string, task: PushTaskDefinition, error: unknown) {
    const pending = this.pending.get(vibeUuid)?.get(`${task.level}:${task.name}`);
    if (pending) {
      pending.message =
        error instanceof Problem ? error.detail : "The inference task could not start.";
      pending.failedAt = new Date();
    }
  }
  end(vibeUuid: string) {
    const pending = this.pending.get(vibeUuid);
    if (!pending) return;
    for (const [key, task] of pending) if (!task.message) pending.delete(key);
    if (!pending.size) this.pending.delete(vibeUuid);
  }
}

export async function readObjectInferenceStatus(
  db: Database,
  activity: PushActivity,
  uuid: string,
  actor: Actor,
): Promise<ObjectInferenceStatus> {
  const access = new AccessService({ db, actor });
  const object = await access.assertMediaObjectScope(uuid, GRANT_SCOPE.READ);
  const elements = await db
    .select({ element: mediaElements })
    .from(mediaObjectElements)
    .innerJoin(mediaElements, eq(mediaElements.uuid, mediaObjectElements.mediaElementUuid))
    .where(eq(mediaObjectElements.mediaObjectUuid, uuid))
    .orderBy(asc(mediaObjectElements.position));
  const records = [
    { ...object, level: "object" as const, kind: undefined },
    ...[...new Map(elements.map(({ element }) => [element.uuid, element])).values()].map(
      (element) => ({ ...element, level: "element" as const }),
    ),
  ];
  const readableVibes = new Map<string, boolean>();
  async function canRead(vibeUuid: string | null, ownerUuid: string): Promise<boolean> {
    if (actor.kind === "user" && actor.uuid === ownerUuid) return true;
    if (!vibeUuid) return false;
    if (readableVibes.has(vibeUuid)) return readableVibes.get(vibeUuid)!;
    try {
      await access.assertVibeScope(vibeUuid, GRANT_SCOPE.READ);
      readableVibes.set(vibeUuid, true);
      return true;
    } catch (error) {
      if (!(error instanceof Problem) || ![403, 404].includes(error.status)) throw error;
      readableVibes.set(vibeUuid, false);
      return false;
    }
  }
  const pushes = await db
    .select()
    .from(operations)
    .where(
      and(
        eq(operations.kind, "push"),
        sql`${operations.request}->>'level' IN ('object', 'element')`,
        sql`${operations.request}->'resolved'->'selection' ?| ARRAY[${sql.join(
          records.map((record) => sql`${record.uuid}`),
          sql`, `,
        )}]::text[]`,
      ),
    )
    .orderBy(desc(operations.createdAt), desc(operations.uuid));
  const visiblePushes: DbOperation[] = [];
  for (const push of pushes)
    if (await canRead(push.vibeUuid, push.ownerUuid)) visiblePushes.push(push);
  const memberships = await db
    .select({ vibeUuid: vibeMediaObjects.vibeUuid })
    .from(vibeMediaObjects)
    .where(eq(vibeMediaObjects.mediaObjectUuid, uuid));
  const pending: PendingTask[] = [];
  for (const { vibeUuid } of memberships) {
    if (!activity.pending.has(vibeUuid) || !(await canRead(vibeUuid, object.ownerUuid))) continue;
    pending.push(
      ...[...activity.pending.get(vibeUuid)!.values()].filter(
        (task) => !task.objectUuids || task.objectUuids.includes(uuid),
      ),
    );
  }
  return {
    records: records.map((record) => {
      const uri = `rnet://${record.level}/${record.uuid}`;
      const latest = new Map<
        string,
        { active: boolean; value: InferenceTaskStatus | null; createdAt: Date }
      >();
      for (const push of visiblePushes) {
        const request = push.request as {
          level: string;
          task: string;
          resolved: { selection: string[]; outcomes_before_run: { preserved_durable: string[] } };
        };
        if (request.level !== record.level || !request.resolved.selection.includes(record.uuid))
          continue;
        const active = push.status === "queued" || push.status === "running";
        const previous = latest.get(request.task);
        if (previous && (!active || previous.active)) continue;
        let value: InferenceTaskStatus | null = null;
        if (active) {
          if (
            !request.resolved.outcomes_before_run.preserved_durable.includes(record.uuid) &&
            !activity.settled.get(push.uuid)?.has(record.uuid)
          )
            value = {
              task: request.task,
              status: activity.calls.get(push.uuid)?.has(record.uuid) ? "running" : "waiting",
              message: null,
            };
        } else {
          const result = push.result as PushOperationResult | null;
          const skipped =
            result && result.level !== "vibe"
              ? result.skipped.find((entry) => entry.uri === uri)
              : undefined;
          const succeeded =
            result &&
            result.level !== "vibe" &&
            (result.written.some((entry) => entry.uri === uri) || result.preserved.includes(uri));
          if (
            !succeeded &&
            skipped &&
            ["call_failed", "invalid_output", "aborted", "context_too_large"].includes(
              skipped.reason,
            )
          )
            value = {
              task: request.task,
              status: "error",
              message:
                push.error ?? `Inference did not complete: ${skipped.code ?? skipped.reason}.`,
            };
          else if (!succeeded && !skipped && ["failed", "aborted"].includes(push.status))
            value = {
              task: request.task,
              status: "error",
              message: push.error ?? "The inference task was interrupted.",
            };
        }
        latest.set(request.task, { active, value, createdAt: push.createdAt });
      }
      for (const task of pending) {
        if (
          task.level !== record.level ||
          (record.level === "element" && !task.elementKinds?.includes(record.kind!)) ||
          record.inferred[storeTaskKey(task.name)]?.durable
        )
          continue;
        if (latest.get(task.name)?.active) continue;
        if (
          task.failedAt &&
          latest.has(task.name) &&
          latest.get(task.name)!.createdAt >= task.failedAt
        )
          continue;
        latest.set(task.name, {
          active: true,
          createdAt: task.failedAt ?? new Date(),
          value: {
            task: task.name,
            status: task.message ? "error" : "waiting",
            message: task.message,
          },
        });
      }
      return {
        uri,
        revision: record.inferredRev,
        tasks: [...latest.values()].flatMap(({ value }) => (value ? [value] : [])),
      };
    }),
  };
}
