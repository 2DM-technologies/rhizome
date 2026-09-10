import { useState } from "react";
import type { MediaObject } from "@rnet/types";
import { storeTaskKey, type PushTaskManifest } from "@rhizome/store-contract";

import { PUSH_TASKS } from "../api/generated/push-tasks.ts";
import { usePushOperation, usePushVibe } from "../queries/index.ts";
import { Button, SelectInput } from "../ui/index.ts";
import { Failed } from "./provisional.tsx";

const TASKS = [...Object.values(PUSH_TASKS.vibe), ...Object.values(PUSH_TASKS.object)];

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

  function run(selection?: string[]) {
    push.mutate(
      {
        params: { path: { id: vibeUuid } },
        body:
          task.level === "object"
            ? { level: "object", task: task.name, ...(selection ? { selection } : {}) }
            : { level: "vibe", task: task.name },
      },
      { onSuccess: (result) => setOperationId(result.operation_id) },
    );
  }

  const busy = push.isPending || ["queued", "running"].includes(operation.data?.status ?? "");
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
            {busy ? "Running…" : "Run"}
          </Button>
        )}
      </div>
      <p className="text-caption text-tertiary">{task.description}</p>
      {operationId ? (
        <p role="status" className="text-caption text-secondary">
          Push {operation.data?.status ?? "queued"}
        </p>
      ) : null}
      {push.isError ? <Failed error={push.error} /> : null}
      {operation.isError ? <Failed error={operation.error} /> : null}
    </section>
  );
}
