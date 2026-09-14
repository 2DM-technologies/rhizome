import {
  PUSH_TASK_REFS,
  type ImportPushPipeline,
} from "../../../packages/store-contract/src/index.ts";

const task = PUSH_TASK_REFS;

/** Common media enrichment selected explicitly by content-oriented source skills. */
export const CONTENT_IMPORT_PUSH_PIPELINE = [
  { task: task.describeMedia, after: [] },
  { task: task.displayName, after: [task.describeMedia] },
  { task: task.searchKeywords, after: [task.displayName] },
  { task: task.summarize, after: [task.searchKeywords] },
  { task: task.vibeView, after: [task.summarize] },
  { task: task.vibeOrb, after: [task.summarize] },
] as const satisfies ImportPushPipeline;
