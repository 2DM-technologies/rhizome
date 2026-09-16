import { useLayoutEffect, useMemo } from "react";
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
export function useEnsureSurfaceOpen(surface: Surface | null): void {
  const openSurface = useShellStore((state) => state.openSurface);
  // A POP can name a surface that is no longer mounted. Open it before paint without
  // changing the URL or synchronizing presentation back into the store.
  useLayoutEffect(() => {
    if (surface) openSurface(surface);
  }, [openSurface, surface]);
}

export interface SurfaceNavigation {
  /** Toggle between the bare desktop and the most recently focused open window. */
  home: (options?: { origin?: Element | null; source?: DockTransitionSource }) => void;
  /** Focus a surface, opening it if it is not already open. */
  open: (surface: Surface, options?: ViewMode | SurfaceOpenOptions) => void;
  /** Focus a surface with a shared-element transition from its dock control. */
  openFromDock: (
    surface: Surface,
    options: {
      origin: Element | null;
      source: DockTransitionSource;
      mode?: ViewMode;
      /** Keep the current route available in the dock; its window still unmounts. */
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
  /** Surface-specific search parameters. Presentation mode is merged in by the shell. */
  search?: Readonly<Record<string, string>>;
  /** Keep the current route available in the dock; its window still unmounts. */
  keepCurrentOpen?: boolean;
}

interface ResolvedSurfaceOpenOptions {
  mode: ViewMode;
  keepCurrentOpen: boolean;
  search?: Readonly<Record<string, string>>;
}

function resolveOpenOptions(
  options: ViewMode | SurfaceOpenOptions | undefined,
  defaultMode: ViewMode,
): ResolvedSurfaceOpenOptions {
  if (typeof options === "string") return { mode: options, keepCurrentOpen: false };
  return {
    mode: options?.mode ?? defaultMode,
    keepCurrentOpen: options?.keepCurrentOpen ?? false,
    ...(options?.search ? { search: options.search } : {}),
  };
}

export function useSurfaceNavigation(): SurfaceNavigation {
  const navigate = useNavigate();
  const location = useLocation();
  const openSurface = useShellStore((state) => state.openSurface);
  const closeSurface = useShellStore((state) => state.closeSurface);
  const setDefaultViewMode = useShellStore((state) => state.setDefaultViewMode);
  const { surface: focused, mode } = useFocusedSurface();

  return {
    home: ({ origin = null, source = "home" } = {}) => {
      if (focused) {
        // Showing the desktop unmounts the window; remember its exact presentation for
        // the next Home click instead of applying the default from some earlier surface.
        setDefaultViewMode(mode);
        navigate("/");
        return;
      }

      const state = useShellStore.getState();
      const remembered = state.lastFocusedSurface;
      const target =
        remembered && state.open.some((surface) => surfaceId(surface) === surfaceId(remembered))
          ? remembered
          : ({ kind: "vibes" } satisfies Surface);
      const nextMode = state.defaultViewMode;
      const animate =
        origin !== null && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (animate) setDockTransitionTarget(target, source, origin.getBoundingClientRect());
      openSurface(target);
      void navigate(locationOf(target, nextMode), animate ? { flushSync: true } : undefined);
    },

    open: (surface, options) => {
      // Async callbacks may outlive a maximize/restore click. Inherit the current choice
      // when navigation happens, not the mode captured when the callback was created.
      const {
        mode: nextMode,
        keepCurrentOpen,
        search,
      } = resolveOpenOptions(options, useShellStore.getState().defaultViewMode);
      openSurface(surface, { keepCurrentOpen });
      setDefaultViewMode(nextMode);
      // Commit URL focus with the new recent route. Deferring it briefly puts the target
      // in the recent rail before moving it to the active slot, reversing the dock's width.
      void navigate(locationOf(surface, nextMode, search), { flushSync: true });
    },

    openFromDock: (surface, { origin, source, mode: requestedMode, keepCurrentOpen = false }) => {
      const nextMode = requestedMode ?? useShellStore.getState().defaultViewMode;
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
      // Reveal the desktop in the same commit that removes the window. A deferred route
      // update leaves one frame with neither surface visible.
      if (focused && surfaceId(focused) === id) void navigate("/", { flushSync: true });
    },

    toggleMaximized: () => {
      if (!focused) return;
      const next: ViewMode = mode === "maximized" ? "standard" : "maximized";
      setDefaultViewMode(next);
      navigate(locationOf(focused, next, new URLSearchParams(location.search)), { replace: true });
    },
  };
}
