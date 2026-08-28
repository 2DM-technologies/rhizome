import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";

import { useShellStore } from "./store.ts";
import {
  locationOf,
  surfaceFromPath,
  surfaceId,
  viewModeOf,
  type Surface,
  type SurfaceId,
  type ViewMode,
} from "./surfaces.ts";

/**
 * The URL half of the shell's contract: which surface is focused, and how it is presented.
 * Read on every render, never mirrored into the store.
 */
export function useFocusedSurface(): { surface: Surface | null; mode: ViewMode } {
  const location = useLocation();
  return { surface: surfaceFromPath(location.pathname), mode: viewModeOf(location.search) };
}

/**
 * The one-directional bridge: *the URL names this surface, so make sure it exists*.
 *
 * It never writes focus, and it runs on every route change rather than only at load, because a
 * link can name a surface that is not open at any moment — not just from a cold start.
 */
export function useEnsureSurfaceOpen(surface: Surface | null): void {
  const openSurface = useShellStore((state) => state.openSurface);
  const id = surface ? surfaceId(surface) : null;
  useEffect(() => {
    if (surface) openSurface(surface);
    // Keyed on the id so re-running depends on identity, not on object reference.
  }, [id, openSurface, surface]);
}

export interface SurfaceNavigation {
  /** Return to the bare desktop. */
  home: () => void;
  /** Focus a surface, opening it if it is not already open. */
  open: (surface: Surface, mode?: ViewMode) => void;
  /** Close a surface. Navigates away only if it was the focused one. */
  close: (id: SurfaceId) => void;
  /** Toggle maximized presentation without spending a history entry. */
  toggleMaximized: () => void;
}

export function useSurfaceNavigation(): SurfaceNavigation {
  const navigate = useNavigate();
  const closeSurface = useShellStore((state) => state.closeSurface);
  const { surface: focused, mode } = useFocusedSurface();

  return {
    home: () => navigate("/"),

    open: (surface, nextMode = "standard") => navigate(locationOf(surface, nextMode)),

    close: (id) => {
      closeSurface(id);
      // The only place the store drives a navigation, and it is a direct user action rather
      // than a reactive effect — which is what keeps it from becoming a loop.
      if (focused && surfaceId(focused) === id) navigate("/");
    },

    toggleMaximized: () => {
      if (!focused) return;
      const next: ViewMode = mode === "maximized" ? "standard" : "maximized";
      navigate(locationOf(focused, next), { replace: true });
    },
  };
}
