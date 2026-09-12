import type { VibeContext } from "../../../context.ts";
import type { TaskOutput } from "../../../task-catalog.ts";

type VibeViewOutput = {
  view: "datatable" | "mediaboard" | "simplelist" | "tweetfeed" | "fitness_log";
  config:
    | { columns: string[]; sort: { pointer: string; direction: "asc" | "desc" } | null }
    | { caption_pointer: string | null }
    | { subtitle_pointer: string | null }
    | Record<string, never>;
};

const TRANSACTION_COLUMNS = [
  "/source/properties/posted_at",
  "/source/properties/raw_description",
  "/source/properties/amount",
  "/source/properties/currency",
] as const;

export function observedPointers(context: VibeContext): Set<string> {
  return new Set(context.types.flatMap((type) => type.pointers.map(({ pointer }) => pointer)));
}

export function chooseVibeView(context: VibeContext): TaskOutput | undefined {
  if (isTweetOnly(context)) return { view: "tweetfeed", config: {} } satisfies VibeViewOutput;

  if (isActivityOnly(context)) return { view: "fitness_log", config: {} } satisfies VibeViewOutput;

  const observed = observedPointers(context);
  if (observed.size === 0)
    return { view: "simplelist", config: { subtitle_pointer: null } } satisfies VibeViewOutput;

  if (context.types.length > 0 && context.types.every(({ type }) => type === "transaction")) {
    const columns = TRANSACTION_COLUMNS.filter((pointer) => observed.has(pointer));
    if (columns.length)
      return {
        view: "datatable",
        config: {
          columns,
          sort: observed.has(TRANSACTION_COLUMNS[0])
            ? { pointer: TRANSACTION_COLUMNS[0], direction: "desc" }
            : null,
        },
      } satisfies VibeViewOutput;
  }

  if (
    context.types.length > 0 &&
    (context.types.every(({ type }) => type === "arena.block") ||
      context.types.every(({ type }) => type === "pinterest.pin")) &&
    context.types.every(({ count, elements }) =>
      elements.some(({ kind, objects }) => kind === "image" && objects === count),
    )
  )
    return {
      view: "mediaboard",
      config: {
        caption_pointer: observed.has("/source/properties/title")
          ? "/source/properties/title"
          : null,
      },
    } satisfies VibeViewOutput;

  if (context.types.length === 1 && context.elements.length === 0) {
    const columns = context.types[0]!.pointers.slice(0, 8).map(({ pointer }) => pointer);
    if (columns.length)
      return { view: "datatable", config: { columns, sort: null } } satisfies VibeViewOutput;
  }
  return undefined;
}

export function validateVibeViewOutput(output: TaskOutput, context: VibeContext): boolean {
  const view = output.view;
  const config = output.config;
  if (!config || typeof config !== "object" || Array.isArray(config)) return false;
  const value = config as Record<string, unknown>;
  if (view === "tweetfeed") return isTweetOnly(context) && Object.keys(value).length === 0;
  if (view === "fitness_log") return isActivityOnly(context) && Object.keys(value).length === 0;
  let pointers: unknown[];
  if (view === "datatable") {
    if (!Array.isArray(value.columns)) return false;
    pointers = [...value.columns];
    if (value.sort !== null) {
      if (!value.sort || typeof value.sort !== "object" || Array.isArray(value.sort)) return false;
      pointers.push((value.sort as Record<string, unknown>).pointer);
    }
  } else if (view === "mediaboard") pointers = [value.caption_pointer];
  else if (view === "simplelist") pointers = [value.subtitle_pointer];
  else return false;
  const observed = observedPointers(context);
  return pointers.every(
    (pointer) => pointer === null || (typeof pointer === "string" && observed.has(pointer)),
  );
}

function isTweetOnly(context: VibeContext): boolean {
  return (
    context.objects > 0 &&
    context.types.length > 0 &&
    context.types.every(({ type }) => type === "tweet") &&
    context.types.reduce((total, { count }) => total + count, 0) === context.objects
  );
}

function isActivityOnly(context: VibeContext): boolean {
  return (
    context.objects > 0 &&
    context.types.length > 0 &&
    context.types.every(({ type }) => type === "fitness_activity") &&
    context.types.reduce((total, { count }) => total + count, 0) === context.objects
  );
}
