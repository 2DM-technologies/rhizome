import type {
  PushOperationResult,
  TaskInferenceStatus,
  TaskInferenceStatusQuery,
} from "@rhizome/store-contract";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Actor } from "../auth.ts";
import type { Database } from "../db/index.ts";
import { GRANT_SCOPE } from "../db/models/grant.ts";
import { operations } from "../db/models/operation.ts";
import { AccessService } from "../services/access-service.ts";
import { schemaProblem } from "../services/problems.ts";
import type { PushActivity } from "./inference-status.ts";
import type { PushTaskCatalog } from "./task-catalog.ts";

/** Task status within one readable Vibe, without exposing operation requests or usage. */
export async function readTaskInferenceStatus(
  db: Database,
  activity: PushActivity,
  catalog: PushTaskCatalog,
  uuid: string,
  input: TaskInferenceStatusQuery,
  actor: Actor,
): Promise<TaskInferenceStatus> {
  const vibe = await new AccessService({ db, actor }).assertVibeScope(uuid, GRANT_SCOPE.READ);
  if (!catalog.get(input.level, input.task))
    throw schemaProblem([
      { instancePath: "/task", message: "is not an installed task at this level" },
    ]);
  const filter = and(
    eq(operations.vibeUuid, uuid),
    eq(operations.kind, "push"),
    sql`${operations.request}->>'level' = ${input.level}`,
    sql`${operations.request}->>'task' = ${input.task}`,
  );
  // An active run takes precedence over terminal history, including a later failed run.
  const [latest] = await db
    .select()
    .from(operations)
    .where(filter)
    .orderBy(
      desc(sql`${operations.status} IN ('queued', 'running')`),
      desc(operations.createdAt),
      desc(operations.uuid),
    )
    .limit(1);
  const base = { ...input, revision: vibe.rev, operation_id: latest?.uuid ?? null, message: null };
  if (latest && ["queued", "running"].includes(latest.status))
    return { ...base, status: latest.status === "queued" ? "waiting" : "running" };
  const pending = activity.pending.get(uuid)?.get(`${input.level}:${input.task}`);
  if (pending && (!pending.failedAt || !latest || latest.createdAt < pending.failedAt))
    return { ...base, status: pending.message ? "error" : "waiting", message: pending.message };
  if (!latest) return { ...base, status: "idle" };
  const result = latest.result as PushOperationResult | null;
  const skips =
    result?.level === "vibe"
      ? result.vibe.outcome === "skipped"
        ? [result.vibe]
        : []
      : (result?.skipped ?? []);
  const failed = skips.find(({ reason }) =>
    ["call_failed", "invalid_output", "aborted", "context_too_large"].includes(reason),
  );
  if (["failed", "aborted"].includes(latest.status) || failed)
    return {
      ...base,
      status: "error",
      message:
        latest.error ??
        `Inference did not complete: ${failed?.code ?? failed?.reason ?? latest.status}.`,
    };
  return { ...base, status: "done" };
}
