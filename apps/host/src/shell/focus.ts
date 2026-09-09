import { useLayoutEffect, useMemo, useRef } from "react";
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
import { setDockTransitionTarget } from "./dockOpenMotion.ts";
import type { DockTransitionSource } from "./dockOpenMotion.ts";

/**
 * The URL half of the shell's contract: which surface is focused, and how it is presented.
 * Read on every render, never mirrored into the store.
 */
export function useFocusedSurface(): { surface: Surface | null; mode: ViewMode } {
  const location = useLocation();
  const surface = useMemo(() => surfaceFromPath(location.pathname), [location.pathname]);
  return { surface, mode: viewModeOf(location.search) };
}

/**
 * The one-directional bridge: *the URL names this surface, so make sure it exists*.
 *
 * It never writes focus, and it runs on every route change rather than only at load, because a
 * link can name a surface that is not open at any moment — not just from a cold start.
 */
export function useEnsureSurfaceOpen(surface: Surface | null, mode: ViewMode): void {
  const navigate = useNavigate();
  const openSurface = useShellStore((state) => state.openSurface);
  const defaultViewMode = useShellStore((state) => state.defaultViewMode);
  const setDefaultViewMode = useShellStore((state) => state.setDefaultViewMode);
  const initializedDefaultMode = useRef(false);
  const id = surface ? surfaceId(surface) : null;
  // A POP updates the URL before the destination surface exists in the window store. Reconcile
  // in a layout effect so React can commit that surface before the browser paints an empty shell.
  useLayoutEffect(() => {
    if (surface) {
      openSurface(surface);
      // A cold deep link establishes the initial default. After that, history traversal may
      // revisit an old URL with a different mode, but only an explicit open or toggle changes
      // the inherited mode. Reading the store imperatively also survives Strict Mode's second
      // effect setup before this hook has re-rendered with the synchronous Zustand update.
      if (!initializedDefaultMode.current) {
        initializedDefaultMode.current = true;
        setDefaultViewMode(mode);
        return;
      }

      const inheritedMode = useShellStore.getState().defaultViewMode;
      if (mode !== inheritedMode) {
        void navigate(locationOf(surface, inheritedMode), { replace: true });
      }
    }
    // Keyed on the id so re-running depends on identity, not on object reference.
  }, [defaultViewMode, id, mode, navigate, openSurface, setDefaultViewMode, surface]);
}

export interface SurfaceNavigation {
  /** Return to the bare desktop. */
  home: () => void;
  /** Focus a surface, opening it if it is not already open. */
  open: (surface: Surface, options?: ViewMode | SurfaceOpenOptions) => void;
  /** Focus a surface with a shared-element transition from its dock control. */
  openFromDock: (
    surface: Surface,
    options: {
      origin: Element | null;
      source: DockTransitionSource;
      mode?: ViewMode;
      /** Preserve the current window instead of replacing it with this surface. */
      keepCurrentOpen?: boolean;
    },
  ) => void;
  /** Close a surface. Navigates away only if it was the focused one. */
  close: (id: SurfaceId) => void;
  /** Toggle maximized presentation without spending a history entry. */
  toggleMaximized: () => void;
}

export interface SurfaceOpenOptions {
  mode?: ViewMode;
  /** Preserve the current window instead of replacing it with this surface. */
  keepCurrentOpen?: boolean;
}

function resolveOpenOptions(
  options: ViewMode | SurfaceOpenOptions | undefined,
  defaultMode: ViewMode,
): Required<SurfaceOpenOptions> {
  if (typeof options === "string") return { mode: options, keepCurrentOpen: false };
  return {
    mode: options?.mode ?? defaultMode,
    keepCurrentOpen: options?.keepCurrentOpen ?? false,
  };
}

export function useSurfaceNavigation(): SurfaceNavigation {
  const navigate = useNavigate();
  const openSurface = useShellStore((state) => state.openSurface);
  const closeSurface = useShellStore((state) => state.closeSurface);
  const defaultViewMode = useShellStore((state) => state.defaultViewMode);
  const setDefaultViewMode = useShellStore((state) => state.setDefaultViewMode);
  const { surface: focused, mode } = useFocusedSurface();

  return {
    home: () => navigate("/"),

    open: (surface, options) => {
      const { mode: nextMode, keepCurrentOpen } = resolveOpenOptions(options, defaultViewMode);
      openSurface(surface, { keepCurrentOpen });
      setDefaultViewMode(nextMode);
      navigate(locationOf(surface, nextMode));
    },

    openFromDock: (
      surface,
      { origin, source, mode: nextMode = defaultViewMode, keepCurrentOpen = false },
    ) => {
      const alreadyFocused = focused !== null && surfaceId(focused) === surfaceId(surface);
      const animate =
        !alreadyFocused &&
        origin !== null &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (animate) setDockTransitionTarget(surface, source, origin.getBoundingClientRect());
      openSurface(surface, { keepCurrentOpen });
      setDefaultViewMode(nextMode);
      void navigate(locationOf(surface, nextMode), animate ? { flushSync: true } : undefined);
    },

    close: (id) => {
      closeSurface(id);
      // The only place the store drives a navigation, and it is a direct user action rather
      // than a reactive effect — which is what keeps it from becoming a loop.
      if (focused && surfaceId(focused) === id) navigate("/");
    },

    toggleMaximized: () => {
      if (!focused) return;
      const next: ViewMode = mode === "maximized" ? "standard" : "maximized";
      setDefaultViewMode(next);
      navigate(locationOf(focused, next), { replace: true });
    },
  };
}
