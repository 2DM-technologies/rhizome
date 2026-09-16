import type { Vibe } from "@rnet/types";

export const VIBE_UPDATED_AT_EXTENSION = "x-rhizome-updated-at";

/** Store revision time, with a creation-time fallback for older conforming stores. */
export function vibeUpdatedAt(vibe: Vibe): string {
  const value = (vibe as unknown as Record<string, unknown>)[VIBE_UPDATED_AT_EXTENSION];
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : (vibe.created_at ?? new Date(0).toISOString());
}

export function newestVibesFirst(left: Vibe, right: Vibe): number {
  return Date.parse(vibeUpdatedAt(right)) - Date.parse(vibeUpdatedAt(left));
}
