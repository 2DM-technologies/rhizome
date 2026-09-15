import type { MediaObject, Vibe } from "@rnet/types";
import { storeTaskKey, VIBE_VIEWS } from "@rhizome/store-contract";
import { PUSH_TASKS } from "../../api/generated/push-tasks.ts";
import type { View } from "./types.ts";

export function properties(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const candidate = (value as Record<string, unknown>).properties;
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : undefined;
}
export function inferredObjectLabel(object: MediaObject): string {
  const display = properties(
    object.inferred?.[storeTaskKey(PUSH_TASKS.object["display-name"].name)],
  )?.display_name;
  return typeof display === "string" && display.trim()
    ? display.trim()
    : `${object.type} ${object.uri.split("/").at(-1) ?? object.uri}`;
}
export function resolveVibeView(vibe: Vibe, objects: MediaObject[]): View | undefined {
  if (objects.length > 0 && objects.every((object) => object.type === "tweet")) return "tweetfeed";
  const view = properties(vibe.inferred?.[storeTaskKey(PUSH_TASKS.vibe["vibe-view"].name)])?.view;
  return VIBE_VIEWS.find((candidate) => candidate === view && candidate !== "tweetfeed");
}
export function displayValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}
