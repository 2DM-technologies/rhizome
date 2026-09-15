import { useState } from "react";
import type { MediaObject } from "@rnet/types";
import {
  isPushOperation,
  storeTaskKey,
  type PushOperationResult,
  type PushTaskManifest,
} from "@rhizome/store-contract";

import { PUSH_TASKS } from "../api/generated/push-tasks.ts";
import { usePushOperation, usePushVibe } from "../queries/index.ts";
import { useTaskInferenceStatus } from "../queries/taskInferenceStatus.ts";
import { Button, InlineError, SelectInput } from "../ui/index.ts";
import { Failed } from "./provisional.tsx";

const TASKS = [
  ...Object.values(PUSH_TASKS.vibe),
  ...Object.values(PUSH_TASKS.object),
  ...Object.values(PUSH_TASKS.element),
];

export function missingObjectUris(objects: MediaObject[], task: string): string[] {
  const key = storeTaskKey(task);
  return [
    ...new Set(objects.filter((object) => !(key in (object.inferred ?? {}))).map(({ uri }) => uri)),
  ];
}

export function PushControl({ objects, vibeUuid }: { objects: MediaObject[]; vibeUuid: string }) {
  const push = usePushVibe();
  const [taskId, setTaskId] = useState(`${TASKS[0]?.level}:${TASKS[0]?.name}`);
  const [operationId, setOperationId] = useState<string>();
  const operation = usePushOperation(operationId, vibeUuid);
  const task = TASKS.find(({ level, name }) => `${level}:${name}` === taskId) as PushTaskManifest;
  const missing = task.level === "object" ? missingObjectUris(objects, task.name) : [];
  useTaskInferenceStatus(vibeUuid, { level: task.level, task: task.name }, true);

  function run(selection?: string[]) {
    push.mutate(
      {
        params: { path: { id: vibeUuid } },
        body:
          task.level === "object"
            ? { level: "object", task: task.name, ...(selection ? { selection } : {}) }
            : task.level === "element"
              ? { level: "element", task: task.name }
              : { level: "vibe", task: task.name },
      },
      { onSuccess: (result) => setOperationId(result.operation_id) },
    );
  }

  const busy = push.isPending || ["queued", "running"].includes(operation.data?.status ?? "");
  const result = operation.data && isPushOperation(operation.data) ? operation.data.result : null;
  return (
    <section
      aria-labelledby="push-heading"
      className="mb-7 flex flex-col gap-3 border-b border-hairline pb-7"
    >
      <h2 id="push-heading" className="text-label text-primary">
        Enrich this Vibe
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        <SelectInput
          aria-label="Push task"
          value={taskId}
          onChange={(event) => setTaskId(event.target.value)}
        >
          {TASKS.map((candidate) => (
            <option
              key={`${candidate.level}:${candidate.name}`}
              value={`${candidate.level}:${candidate.name}`}
            >
              {candidate.label}
            </option>
          ))}
        </SelectInput>
        {task.level === "object" ? (
          <>
            <Button
              variant="secondary"
              disabled={busy || missing.length === 0}
              onClick={() => run(missing)}
            >
              Run on missing
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => run()}>
              Rerun all
            </Button>
          </>
        ) : (
          <Button variant="secondary" disabled={busy} onClick={() => run()}>
            {task.level === "element" ? "Rerun all" : busy ? "Running…" : "Run"}
          </Button>
        )}
      </div>
      <p className="text-caption text-tertiary">{task.description}</p>
      {operationId ? (
        <p role="status" className="text-caption text-secondary">
          Push {operation.data?.status ?? "queued"}
        </p>
      ) : null}
      {!busy && result ? (
        <p className="text-caption text-secondary">{pushResultSummary(result)}</p>
      ) : null}
      {!busy && operation.data?.error ? <InlineError>{operation.data.error}</InlineError> : null}
      {push.isError ? <Failed error={push.error} /> : null}
      {operation.isError ? <Failed error={operation.error} /> : null}
    </section>
  );
}

export function pushResultSummary(result: PushOperationResult): string {
  const tally =
    result.level === "object"
      ? result.objects
      : result.level === "element"
        ? result.elements
        : undefined;
  const summary = tally
    ? `${tally.written} updated, ${tally.removed} removed, ${tally.preserved_durable} kept, ${tally.skipped} skipped, ${tally.failed} failed.`
    : result.level === "vibe" && result.vibe.outcome === "written"
      ? "Vibe updated."
      : "Vibe unchanged.";
  const limit =
    result.abort_reason === "max_wall"
      ? "Time limit reached."
      : result.abort_reason === "max_tokens"
        ? "Token limit reached."
        : result.abort_reason === "max_turns"
          ? "Call limit reached."
          : undefined;
  const reason =
    result.level === "vibe" && result.vibe.outcome === "skipped"
      ? result.vibe.reason.replaceAll("_", " ")
      : undefined;
  return [summary, reason ? `Reason: ${reason}.` : undefined, limit].filter(Boolean).join(" ");
}
