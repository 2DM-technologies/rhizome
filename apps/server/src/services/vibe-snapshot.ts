import type { Grant } from "@rnet/types";
import type { DbVibe } from "../db/models/vibe.ts";

export function snapshotVibe(vibeRecord: DbVibe, activeGrants: Grant[]): Record<string, unknown> {
  return {
    title: vibeRecord.title,
    inferred: vibeRecord.inferred,
    pull_config: vibeRecord.pullConfig,
    grants: activeGrants,
  };
}
