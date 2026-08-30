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

export const SHELL_STORE_VERSION = 1;

interface PersistedShellState {
  open: Surface[];
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

/** Collapse pre-policy window accumulation while leaving versioned opt-in window sets intact. */
export function migrateShellPersistedState(
  persistedState: unknown,
  persistedVersion: number,
): unknown {
  if (persistedVersion >= SHELL_STORE_VERSION) return persistedState;

  const record = isRecord(persistedState) ? persistedState : {};
  const validOpen = Array.isArray(record.open) ? record.open.filter(isSurface) : [];
  return {
    // The legacy store appended new windows, making the final valid entry the best available
    // proxy for the window the user opened most recently.
    open: validOpen.slice(-1),
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
      defaultViewMode: "standard",
      agentOpen: false,
      launcherOpen: false,

      // Idempotent for a surface that is already open. A genuinely new surface replaces the
      // current window set by default so inactive React trees do not accumulate indefinitely.
      // Callers that deliberately need concurrent windows must opt in for that navigation.
      openSurface: (surface, { keepCurrentOpen = false } = {}) =>
        set((state) => {
          const open = nextOpenSurfaces(state.open, surface, { keepCurrentOpen });
          return open === state.open ? state : { open };
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
      // Open windows and their shared presentation default are restorable. Bridge status and
      // panel state would be lies after a reload — nothing is connected and no panel is open.
      partialize: (state) => ({ open: state.open, defaultViewMode: state.defaultViewMode }),
    },
  ),
);

export function useOpenSurfaces(): Surface[] {
  return useShellStore((state) => state.open);
}
