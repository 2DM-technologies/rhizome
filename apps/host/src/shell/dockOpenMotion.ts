import { surfaceId, type Surface } from "./surfaces.ts";

export type DockTransitionSource = "home" | "launcher" | "running";

export interface DockOpenTransition {
  key: number;
  origin: {
    height: number;
    left: number;
    top: number;
    width: number;
  };
  source: DockTransitionSource;
  targetId: string;
}

let nextKey = 0;
let pending: DockOpenTransition | null = null;

/** Record the dock geometry that the next activated surface should grow from. */
export function setDockTransitionTarget(
  surface: Surface,
  source: DockTransitionSource,
  origin: DOMRectReadOnly,
): void {
  pending = {
    key: (nextKey += 1),
    origin: {
      height: origin.height,
      left: origin.left,
      top: origin.top,
      width: origin.width,
    },
    source,
    targetId: surfaceId(surface),
  };
}

export function dockOpenTransitionFor(surface: Surface): DockOpenTransition | null {
  return pending?.targetId === surfaceId(surface) ? pending : null;
}

/** Prevent session-history navigation from replaying a completed dock pairing. */
export function clearDockTransitionTarget(targetId: string, key: number): void {
  if (pending?.targetId === targetId && pending.key === key) pending = null;
}
