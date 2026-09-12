import type { InferenceTaskStatus } from "@rhizome/store-contract";
import { CodeBlock, InlineError } from "../ui/index.ts";

export function InferredBlock({
  value,
  tasks = [],
  label,
}: {
  value: Record<string, unknown>;
  tasks?: InferenceTaskStatus[];
  label: string;
}) {
  const state = tasks.some((task) => task.status === "running")
    ? "running"
    : tasks.some((task) => task.status === "waiting")
      ? "waiting"
      : "idle";
  const busy = state !== "idle";
  const hasContent = Object.keys(value).length > 0;
  return (
    <div className="flex min-w-0 flex-col gap-3" aria-label={label}>
      <div className="inferred-block" data-inference-state={state} aria-busy={busy}>
        {busy && !hasContent ? (
          <div className="flex flex-col gap-2 p-3" aria-hidden="true">
            <span className="inferred-skeleton-line w-3" />
            <div className="ml-4 flex items-center gap-2">
              <span className="inferred-skeleton-line w-32" />
            </div>
            <div className="ml-8 flex items-center gap-2">
              <span className="inferred-skeleton-line w-14" />
              <span className="inferred-skeleton-line w-28" />
            </div>
            <div className="ml-8 flex items-center gap-2">
              <span className="inferred-skeleton-line w-24" />
              <span className="inferred-skeleton-line w-36" />
            </div>
            <div className="ml-8 flex items-center gap-2">
              <span className="inferred-skeleton-line w-20" />
            </div>
            <div className="ml-12 flex items-center gap-2">
              <span className="inferred-skeleton-line w-24" />
              <span className="inferred-skeleton-line w-28" />
            </div>
            <span className="inferred-skeleton-line ml-8 w-3" />
            <span className="inferred-skeleton-line ml-4 w-3" />
            <span className="inferred-skeleton-line w-3" />
          </div>
        ) : (
          <CodeBlock className="max-h-72">{JSON.stringify(value, null, 2)}</CodeBlock>
        )}
      </div>
      <span className="sr-only" role="status">
        {state === "running"
          ? `${label}: generating`
          : state === "waiting"
            ? `${label}: waiting`
            : ""}
      </span>
      {tasks
        .filter((task) => task.status === "error")
        .map((task) => (
          <InlineError key={task.task}>{task.message ?? "Inference failed."}</InlineError>
        ))}
    </div>
  );
}
