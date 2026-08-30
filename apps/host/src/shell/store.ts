import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { surfaceId, type Surface, type SurfaceId, type ViewMode } from "./surfaces.ts";

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
  /** Vibes opened in this browser session, most recently opened first. */
  recentVibeUuids: string[];
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

export const SHELL_STORE_VERSION = 2;

interface PersistedShellState {
  open: Surface[];
  recentVibeUuids: string[];
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

function recentVibeUuidsFrom(surfaces: readonly Surface[]): string[] {
  const recent: string[] = [];
  for (let index = surfaces.length - 1; index >= 0; index -= 1) {
    const surface = surfaces[index];
    if (surface?.kind === "vibe" && !recent.includes(surface.uuid)) recent.push(surface.uuid);
  }
  return recent;
}

/** Add an opened Vibe to the front of the MRU list without retaining duplicate entries. */
export function nextRecentVibeUuids(recentVibeUuids: string[], surface: Surface): string[] {
  if (surface.kind !== "vibe") return recentVibeUuids;

  const withoutSurface = recentVibeUuids.filter((uuid) => uuid !== surface.uuid);
  if (recentVibeUuids[0] === surface.uuid && withoutSurface.length === recentVibeUuids.length - 1) {
    return recentVibeUuids;
  }
  return [surface.uuid, ...withoutSurface];
}

/** Collapse pre-policy window accumulation while preserving versioned opt-in window sets. */
export function migrateShellPersistedState(
  persistedState: unknown,
  persistedVersion: number,
): unknown {
  if (persistedVersion >= SHELL_STORE_VERSION) return persistedState;

  const record = isRecord(persistedState) ? persistedState : {};
  const validOpen = Array.isArray(record.open) ? record.open.filter(isSurface) : [];
  return {
    // The legacy store appended new windows, making the final valid entry the best available
    // proxy for the window the user opened most recently. Version 1 already enforced the
    // replacement policy, so its deliberately retained window set stays intact.
    open: persistedVersion < 1 ? validOpen.slice(-1) : validOpen,
    recentVibeUuids: recentVibeUuidsFrom(validOpen),
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
      recentVibeUuids: [],
      defaultViewMode: "standard",
      agentOpen: false,
      launcherOpen: false,

      // Idempotent for a surface that is already open. A genuinely new surface replaces the
      // current window set by default so inactive React trees do not accumulate indefinitely.
      // Callers that deliberately need concurrent windows must opt in for that navigation.
      openSurface: (surface, { keepCurrentOpen = false } = {}) =>
        set((state) => {
          const open = nextOpenSurfaces(state.open, surface, { keepCurrentOpen });
          const recentVibeUuids = nextRecentVibeUuids(state.recentVibeUuids, surface);
          return open === state.open && recentVibeUuids === state.recentVibeUuids
            ? state
            : { open, recentVibeUuids };
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
        recentVibeUuids: state.recentVibeUuids,
        defaultViewMode: state.defaultViewMode,
      }),
    },
  ),
);

export function useOpenSurfaces(): Surface[] {
  return useShellStore((state) => state.open);
}
