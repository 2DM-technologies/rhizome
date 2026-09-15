import type { ReactNode } from "react";
import type { Vibe } from "@rnet/types";
import {
  storeTaskKey,
  type InferenceTaskStatus,
  type TaskInferenceStatus,
} from "@rhizome/store-contract";
import { PUSH_TASKS } from "../api/generated/push-tasks.ts";
import { InlineError, SectionCard } from "../ui/index.ts";
import { InferredBlock } from "./InferredBlock.tsx";

export function VibeOverview({
  vibe,
  status,
  viewStatus,
  orbStatus,
  inferredError,
  error,
  children,
}: {
  vibe: Vibe;
  status?: TaskInferenceStatus;
  viewStatus?: TaskInferenceStatus;
  orbStatus?: TaskInferenceStatus;
  inferredError?: string;
  error?: string;
  children?: ReactNode;
}) {
  const summary = vibe.inferred?.[storeTaskKey(PUSH_TASKS.vibe.summarize.name)]?.properties.summary;
  const busy = status?.status === "waiting" || status?.status === "running";
  const tasks: InferenceTaskStatus[] = [status, viewStatus, orbStatus].flatMap((task) =>
    task && (task.status === "waiting" || task.status === "running" || task.status === "error")
      ? [
          {
            task: task.task,
            status: task.status,
            message: task.message,
          },
        ]
      : [],
  );
  return (
    <div
      className="mb-13 grid min-w-0 grid-cols-1 items-start gap-6 md:grid-cols-2"
      aria-label="Vibe overview"
    >
      <div className="flex min-w-0 flex-col gap-6">
        <section aria-label="Summary" className="flex min-w-0 flex-col gap-3">
          <h2 className="text-label text-primary">Summary</h2>
          {busy && typeof summary !== "string" ? (
            <div
              className="flex flex-col gap-3 [--inferred-base:var(--rz-skeleton-base)]"
              data-inference-state="waiting"
              aria-busy="true"
              aria-label="Summary loading"
            >
              <span
                aria-hidden="true"
                className="inferred-skeleton-line w-full motion-safe:animate-pulse"
              />
              <span
                aria-hidden="true"
                className="inferred-skeleton-line w-2/3 motion-safe:animate-pulse"
              />
              <span role="status" className="sr-only">
                Waiting for summary
              </span>
            </div>
          ) : typeof summary === "string" ? (
            <p className="text-body text-secondary">{summary}</p>
          ) : (
            <p className="text-body text-tertiary">No summary yet.</p>
          )}
          {status?.status === "error" ? (
            <InlineError>{status.message ?? "Summarization failed."}</InlineError>
          ) : null}
          {error ? <InlineError>{error}</InlineError> : null}
        </section>
        {children}
      </div>
      <SectionCard
        title="Inferred"
        className="h-[280px] min-w-0 [&>div]:min-h-0 [&>div]:flex-1 [&_.inferred-block]:min-h-0 [&_.inferred-block]:flex-1 [&_pre]:h-full [&_pre]:max-h-none"
      >
        <InferredBlock value={vibe.inferred ?? {}} tasks={tasks} label="Vibe inferred" />
        {inferredError ? <InlineError>{inferredError}</InlineError> : null}
      </SectionCard>
    </div>
  );
}
