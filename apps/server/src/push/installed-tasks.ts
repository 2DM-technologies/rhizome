import { storeTaskKey } from "@rhizome/store-contract";
import type { Vibe } from "@rnet/types";
import { PushTaskCatalog, type PushTaskDefinition } from "./task-catalog.ts";
import { summarize } from "./tasks/vibe/summarize/manifest.ts";

export const installedPushTasks = new PushTaskCatalog([summarize]);

/** Task-specific context policy stays beside the installed definitions. */
export function getVibeSummary(
  inferred: Vibe["inferred"],
  task: PushTaskDefinition,
): string | null | undefined {
  if (task.level === summarize.level && task.name === summarize.name) return undefined;
  const summary = inferred?.[storeTaskKey(summarize.name)]?.properties.summary;
  return typeof summary === "string" ? summary : null;
}
