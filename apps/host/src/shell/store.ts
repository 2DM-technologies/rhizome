import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { surfaceId, type Surface, type SurfaceId } from "./surfaces.ts";

/**
 * Shell state: what exists, not what is focused.
 *
 * There is deliberately no `focused` field. Focus lives in the URL and is read from it on
 * every render, which is what keeps back/forward and deep links working continuously rather
 * than only resolving correctly at boot. Adding a focus field here would create a second
 * source of truth and, inevitably, an effect that writes one into the other.
 */
interface ShellState {
  /** Open surfaces in dock order. Survives navigation; a route change never clears it. */
  open: Surface[];
  agentOpen: boolean;
  launcherOpen: boolean;
  openSurface: (surface: Surface) => void;
  closeSurface: (id: SurfaceId) => void;
  setAgentOpen: (open: boolean) => void;
  setLauncherOpen: (open: boolean) => void;
}

export const useShellStore = create<ShellState>()(
  persist(
    (set) => ({
      open: [],
      agentOpen: false,
      launcherOpen: false,

      // Idempotent: returning the same state object skips the update entirely, so the effect
      // that calls this on every route change cannot loop.
      openSurface: (surface) =>
        set((state) =>
          state.open.some((existing) => surfaceId(existing) === surfaceId(surface))
            ? state
            : { open: [...state.open, surface] },
        ),

      closeSurface: (id) =>
        set((state) => ({ open: state.open.filter((surface) => surfaceId(surface) !== id) })),

      setAgentOpen: (agentOpen) => set({ agentOpen }),
      setLauncherOpen: (launcherOpen) => set({ launcherOpen }),
    }),
    {
      name: "rhizome.shell",
      storage: createJSONStorage(() => sessionStorage),
      // Only the open set is restorable. Bridge status and panel state would be lies after a
      // reload — nothing is connected yet and no panel is really open.
      partialize: (state) => ({ open: state.open }),
    },
  ),
);

export function useOpenSurfaces(): Surface[] {
  return useShellStore((state) => state.open);
}
