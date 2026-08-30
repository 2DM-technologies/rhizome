import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  isVibeSurface,
  surfaceId,
  type Surface,
  type SurfaceId,
  type VibeSurface,
  type ViewMode,
} from "./surfaces.ts";

/**
 * Shell state: what exists, not what is focused.
 *
 * There is deliberately no `focused` field. Focus lives in the URL and is read from it on
 * every render, which is what keeps back/forward and deep links working continuously rather
 * than only resolving correctly at boot. Adding a focus field here would create a second
 * source of truth and, inevitably, an effect that writes one into the other.
 */
interface ShellState {
  /** Open surfaces in dock order. Normally one surface; explicit navigation can preserve more. */
  open: Surface[];
  /** Vibe routes opened in this browser session, most recently opened first. */
  recentVibeSurfaces: VibeSurface[];
  /** Presentation inherited by the next surface; focused presentation itself still lives in the URL. */
  defaultViewMode: ViewMode;
  agentOpen: boolean;
  launcherOpen: boolean;
  openSurface: (surface: Surface, options?: OpenSurfaceOptions) => void;
  closeSurface: (id: SurfaceId) => void;
  setDefaultViewMode: (mode: ViewMode) => void;
  setAgentOpen: (open: boolean) => void;
  setLauncherOpen: (open: boolean) => void;
}

export interface OpenSurfaceOptions {
  /** Preserve the existing window set while opening a new surface. */
  keepCurrentOpen?: boolean;
}

export const SHELL_STORE_VERSION = 3;

interface PersistedShellState {
  open: Surface[];
  recentVibeSurfaces: VibeSurface[];
  defaultViewMode: ViewMode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSurface(value: unknown): value is Surface {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "import":
    case "vibes":
      return true;
    case "vibe":
    case "object":
      return typeof value.uuid === "string";
    case "dmachine":
      return typeof value.name === "string";
    default:
      return false;
  }
}

function uniqueVibeSurfaces(surfaces: readonly Surface[]): VibeSurface[] {
  const recent: VibeSurface[] = [];
  const seen = new Set<SurfaceId>();
  for (const surface of surfaces) {
    if (!isVibeSurface(surface)) continue;
    const id = surfaceId(surface);
    if (seen.has(id)) continue;
    seen.add(id);
    recent.push(surface);
  }
  return recent;
}

function recentVibeSurfacesFrom(surfaces: readonly Surface[]): VibeSurface[] {
  const newestFirst: Surface[] = [];
  for (let index = surfaces.length - 1; index >= 0; index -= 1) {
    const surface = surfaces[index];
    if (surface) newestFirst.push(surface);
  }
  return uniqueVibeSurfaces(newestFirst);
}

/** Add an opened Vibe route to the front of the MRU list without duplicate entries. */
export function nextRecentVibeSurfaces(
  recentVibeSurfaces: VibeSurface[],
  surface: Surface,
): VibeSurface[] {
  if (!isVibeSurface(surface)) return recentVibeSurfaces;

  const id = surfaceId(surface);
  const withoutSurface = recentVibeSurfaces.filter((recent) => surfaceId(recent) !== id);
  if (
    recentVibeSurfaces[0] &&
    surfaceId(recentVibeSurfaces[0]) === id &&
    withoutSurface.length === recentVibeSurfaces.length - 1
  ) {
    return recentVibeSurfaces;
  }
  return [surface, ...withoutSurface];
}

/** Collapse pre-policy window accumulation while preserving versioned opt-in window sets. */
export function migrateShellPersistedState(
  persistedState: unknown,
  persistedVersion: number,
): unknown {
  if (persistedVersion >= SHELL_STORE_VERSION) return persistedState;

  const record = isRecord(persistedState) ? persistedState : {};
  const validOpen = Array.isArray(record.open) ? record.open.filter(isSurface) : [];
  const legacyRecentVibes = Array.isArray(record.recentVibeUuids)
    ? record.recentVibeUuids.flatMap((uuid): VibeSurface[] =>
        typeof uuid === "string" ? [{ kind: "vibe", uuid }] : [],
      )
    : [];
  const persistedRecentVibes = Array.isArray(record.recentVibeSurfaces)
    ? record.recentVibeSurfaces.filter(isSurface)
    : [];
  return {
    // The legacy store appended new windows, making the final valid entry the best available
    // proxy for the window the user opened most recently. Version 1 already enforced the
    // replacement policy, so its deliberately retained window set stays intact.
    open: persistedVersion < 1 ? validOpen.slice(-1) : validOpen,
    recentVibeSurfaces: uniqueVibeSurfaces([
      ...recentVibeSurfacesFrom(validOpen),
      ...persistedRecentVibes,
      ...legacyRecentVibes,
    ]),
    defaultViewMode: record.defaultViewMode === "maximized" ? "maximized" : "standard",
  } satisfies PersistedShellState;
}

export function nextOpenSurfaces(
  open: Surface[],
  surface: Surface,
  { keepCurrentOpen = false }: OpenSurfaceOptions = {},
): Surface[] {
  if (open.some((existing) => surfaceId(existing) === surfaceId(surface))) return open;
  return keepCurrentOpen ? [...open, surface] : [surface];
}

export const useShellStore = create<ShellState>()(
  persist(
    (set) => ({
      open: [],
      recentVibeSurfaces: [],
      defaultViewMode: "standard",
      agentOpen: false,
      launcherOpen: false,

      // Idempotent for a surface that is already open. A genuinely new surface replaces the
      // current window set by default so inactive React trees do not accumulate indefinitely.
      // Callers that deliberately need concurrent windows must opt in for that navigation.
      openSurface: (surface, { keepCurrentOpen = false } = {}) =>
        set((state) => {
          const open = nextOpenSurfaces(state.open, surface, { keepCurrentOpen });
          const recentVibeSurfaces = nextRecentVibeSurfaces(state.recentVibeSurfaces, surface);
          return open === state.open && recentVibeSurfaces === state.recentVibeSurfaces
            ? state
            : { open, recentVibeSurfaces };
        }),

      closeSurface: (id) =>
        set((state) => ({ open: state.open.filter((surface) => surfaceId(surface) !== id) })),

      setDefaultViewMode: (defaultViewMode) => set({ defaultViewMode }),
      setAgentOpen: (agentOpen) => set({ agentOpen }),
      setLauncherOpen: (launcherOpen) => set({ launcherOpen }),
    }),
    {
      name: "rhizome.shell",
      storage: createJSONStorage(() => sessionStorage),
      version: SHELL_STORE_VERSION,
      migrate: migrateShellPersistedState,
      // Open windows, recent Vibes, and their shared presentation default are restorable. Bridge
      // status and panel state would be lies after a reload — nothing is connected or open.
      partialize: (state) => ({
        open: state.open,
        recentVibeSurfaces: state.recentVibeSurfaces,
        defaultViewMode: state.defaultViewMode,
      }),
    },
  ),
);

export function useOpenSurfaces(): Surface[] {
  return useShellStore((state) => state.open);
}
