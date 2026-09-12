import { storeTaskKey } from "@rhizome/store-contract";
import type { Vibe } from "@rnet/types";
import { PushTaskCatalog, type PushTaskDefinition } from "./task-catalog.ts";
import type { VibeContext } from "./context.ts";
import { describeMedia } from "./tasks/element/describe_media/manifest.ts";
import { displayName } from "./tasks/object/display_name/manifest.ts";
import { searchKeywords } from "./tasks/object/search_keywords/manifest.ts";
import { summarize } from "./tasks/vibe/summarize/manifest.ts";
import { vibeView } from "./tasks/vibe/vibe_view/manifest.ts";
import { validateVibeViewOutput } from "./tasks/vibe/vibe_view/rules.ts";

export const installedPushTasks = new PushTaskCatalog([
  summarize,
  vibeView,
  displayName,
  searchKeywords,
  describeMedia,
]);

/** Apply installed task output policies after static schema validation. */
export function validateInstalledTaskOutput(
  task: PushTaskDefinition,
  output: Record<string, unknown>,
  context: VibeContext,
): boolean {
  if (task.level === summarize.level && task.name === summarize.name) {
    // JavaScript's $ can match before a final newline; provider patterns cannot use lookaround.
    return typeof output.title === "string" && output.title === output.title.trim();
  }
  if (task.level === vibeView.level && task.name === vibeView.name)
    return validateVibeViewOutput(output, context);
  return true;
}

/** Task-specific context policy stays beside the installed definitions. */
export function getVibeSummary(
  inferred: Vibe["inferred"],
  task: PushTaskDefinition,
): string | null | undefined {
  if (task.level === summarize.level && task.name === summarize.name) return undefined;
  const summary = inferred?.[storeTaskKey(summarize.name)]?.properties.summary;
  return typeof summary === "string" ? summary : null;
}
