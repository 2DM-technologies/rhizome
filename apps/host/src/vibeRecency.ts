import type { Vibe } from "@rnet/types";

export function newestVibesFirst(left: Vibe, right: Vibe): number {
  return Date.parse(right.updated_at) - Date.parse(left.updated_at);
}
