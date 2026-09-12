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
          <div
            className="flex flex-col gap-1.5 p-3 font-mono text-caption text-tertiary"
            aria-hidden="true"
          >
            <span>{"{"}</span>
            <div className="ml-4 flex items-center gap-2">
              <span className="inferred-skeleton-line w-32" />
              <span>{": {"}</span>
            </div>
            <div className="ml-8 flex items-center gap-2">
              <span className="inferred-skeleton-line w-14" />
              <span>:</span>
              <span className="inferred-skeleton-line w-28" />
              <span>,</span>
            </div>
            <div className="ml-8 flex items-center gap-2">
              <span className="inferred-skeleton-line w-24" />
              <span>:</span>
              <span className="inferred-skeleton-line w-36" />
              <span>,</span>
            </div>
            <div className="ml-8 flex items-center gap-2">
              <span className="inferred-skeleton-line w-20" />
              <span>{": {"}</span>
            </div>
            <div className="ml-12 flex items-center gap-2">
              <span className="inferred-skeleton-line w-24" />
              <span>:</span>
              <span className="inferred-skeleton-line w-28" />
            </div>
            <span className="ml-8">{"}"}</span>
            <span className="ml-4">{"}"}</span>
            <span>{"}"}</span>
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
