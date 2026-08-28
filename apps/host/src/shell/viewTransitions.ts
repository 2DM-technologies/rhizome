import { surfaceId, type Surface } from "./surfaces.ts";

export const SURFACE_VIEW_TRANSITION_CLASS = "rz-dock-surface";

export type DockTransitionSource = "home" | "launcher" | "running";

let pending: { targetId: string; source: DockTransitionSource } | null = null;

/** Record the one surface that should grow from the dock during the next navigation. */
export function setDockTransitionTarget(surface: Surface, source: DockTransitionSource): void {
  pending = { targetId: surfaceId(surface), source };
}

export function isDockTransitionTarget(surface: Surface): boolean {
  return pending?.targetId === surfaceId(surface);
}

export function isDockTransitionSource(surface: Surface, source: DockTransitionSource): boolean {
  return pending?.targetId === surfaceId(surface) && pending.source === source;
}

/** Prevent session-history navigation from replaying a completed dock pairing. */
export function clearDockTransitionTarget(surface: Surface): void {
  if (pending?.targetId === surfaceId(surface)) pending = null;
}

/** CSS custom identifiers cannot contain the punctuation used by SurfaceId, so encode it. */
export function surfaceViewTransitionName(surface: Surface): string {
  const encoded = [...surfaceId(surface)]
    .map((character) => character.codePointAt(0)?.toString(16))
    .join("-");
  return `rz-surface-${encoded}`;
}
