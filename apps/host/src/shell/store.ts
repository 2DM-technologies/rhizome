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
  /** Reopenable routes in dock order. Only the URL's focused route is mounted. */
  open: Surface[];
  /** All routes opened in this browser session, most recently opened first. */
  recentSurfaces: Surface[];
  /** Last focused window, retained while the bare desktop is showing. */
  lastFocusedSurface: Surface | null;
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
  /** Preserve existing dock routes while opening a new surface, without retaining their UI. */
  keepCurrentOpen?: boolean;
}

export const SHELL_STORE_VERSION = 5;

interface PersistedShellState {
  open: Surface[];
  recentSurfaces: Surface[];
  lastFocusedSurface: Surface | null;
  defaultViewMode: ViewMode;
}

/** Add any opened route to the front of the MRU list without duplicate entries. */
export function nextRecentSurfaces(recentSurfaces: Surface[], surface: Surface): Surface[] {
  const id = surfaceId(surface);
  const withoutSurface = recentSurfaces.filter((recent) => surfaceId(recent) !== id);
  if (
    recentSurfaces[0] &&
    surfaceId(recentSurfaces[0]) === id &&
    withoutSurface.length === recentSurfaces.length - 1
  ) {
    return recentSurfaces;
  }
  return [surface, ...withoutSurface];
}

function emptyPersistedShellState(): PersistedShellState {
  return {
    open: [],
    recentSurfaces: [],
    lastFocusedSurface: null,
    defaultViewMode: "maximized",
  };
}

/** Discard superseded alpha session state; the current URL restores the focused route. */
export function migrateShellPersistedState(
  persistedState: unknown,
  persistedVersion: number,
): unknown {
  if (persistedVersion >= SHELL_STORE_VERSION) return persistedState;

  return emptyPersistedShellState();
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
      ...emptyPersistedShellState(),
      agentOpen: false,
      launcherOpen: false,

      // Idempotent for a surface that is already open. A genuinely new surface replaces the
      // current window set by default so inactive React trees do not accumulate indefinitely.
      // Callers that deliberately need concurrent windows must opt in for that navigation.
      openSurface: (surface, { keepCurrentOpen = false } = {}) =>
        set((state) => {
          const open = nextOpenSurfaces(state.open, surface, { keepCurrentOpen });
          const recentSurfaces = nextRecentSurfaces(state.recentSurfaces, surface);
          return open === state.open &&
            recentSurfaces === state.recentSurfaces &&
            state.lastFocusedSurface &&
            surfaceId(state.lastFocusedSurface) === surfaceId(surface)
            ? state
            : { open, recentSurfaces, lastFocusedSurface: surface };
        }),

      closeSurface: (id) =>
        set((state) => {
          const open = state.open.filter((surface) => surfaceId(surface) !== id);
          const closingLastFocused =
            state.lastFocusedSurface && surfaceId(state.lastFocusedSurface) === id;
          return {
            open,
            lastFocusedSurface: closingLastFocused
              ? (open.at(-1) ?? null)
              : state.lastFocusedSurface,
          };
        }),

      setDefaultViewMode: (defaultViewMode) => set({ defaultViewMode }),
      setAgentOpen: (agentOpen) => set({ agentOpen }),
      setLauncherOpen: (launcherOpen) => set({ launcherOpen }),
    }),
    {
      name: "rhizome.shell",
      storage: createJSONStorage(() => sessionStorage),
      version: SHELL_STORE_VERSION,
      migrate: migrateShellPersistedState,
      // Open windows, recent routes, and their shared presentation default are restorable. Bridge
      // status and panel state would be lies after a reload — nothing is connected or open.
      partialize: (state) => ({
        open: state.open,
        recentSurfaces: state.recentSurfaces,
        lastFocusedSurface: state.lastFocusedSurface,
        defaultViewMode: state.defaultViewMode,
      }),
    },
  ),
);

export function useOpenSurfaces(): Surface[] {
  return useShellStore((state) => state.open);
}
