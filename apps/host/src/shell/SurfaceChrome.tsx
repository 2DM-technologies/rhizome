import { useEffect, type ReactNode } from "react";
import { useViewTransitionState } from "react-router";

import { DmachineWindow, MaximizeIcon, RestoreIcon, cn } from "../ui/index.ts";
import { useSurfaceNavigation } from "./focus.ts";
import { locationOf, surfaceId, type Surface, type ViewMode } from "./surfaces.ts";
import {
  clearDockTransitionTarget,
  isDockTransitionTarget,
  SURFACE_VIEW_TRANSITION_CLASS,
  surfaceViewTransitionName,
} from "./viewTransitions.ts";

interface SurfaceChromeProps {
  surface: Surface;
  active: boolean;
  mode: ViewMode;
  children: ReactNode;
}

/**
 * Geometry for one surface, and nothing else. A backgrounded surface stays mounted — `hidden`
 * removes it from layout and `inert` from the tab order and the accessibility tree, but its
 * DOM, its scroll position, and (at M4) its iframe all survive.
 *
 * Maximized makes the surface itself full-bleed. Equal-and-opposite padding preserves the
 * standard window's content rectangle while the outer edges expand, so maximizing never moves
 * the document. The dock is a higher-stacking sibling and stays visible over the opaque canvas.
 */
export function SurfaceChrome({ surface, active, mode, children }: SurfaceChromeProps) {
  const id = surfaceId(surface);
  const transitioning = useViewTransitionState(locationOf(surface, mode));
  const participates = active && transitioning && isDockTransitionTarget(surface);
  useEffect(() => {
    if (!participates) return;
    return () => clearDockTransitionTarget(surface);
  }, [participates, surface]);
  const maximized = active && mode === "maximized";
  const { close, toggleMaximized } = useSurfaceNavigation();
  const windowControls = (
    <div data-window-controls className="absolute top-3 right-3 z-10 flex items-center gap-1">
      <button
        type="button"
        aria-label={maximized ? "Restore window" : "Maximize window"}
        onClick={toggleMaximized}
        className="grid size-8 place-items-center rounded-pill bg-surface text-secondary transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {maximized ? <RestoreIcon /> : <MaximizeIcon />}
      </button>
      <button
        type="button"
        aria-label="Close surface"
        onClick={() => close(id)}
        className="grid size-8 place-items-center rounded-pill bg-surface text-xl leading-none text-secondary transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span aria-hidden>×</span>
      </button>
    </div>
  );
  return (
    <div
      hidden={!active}
      inert={!active}
      aria-hidden={!active || undefined}
      data-surface-transition-target={participates || undefined}
      data-surface-id={id}
      data-view-mode={maximized ? "maximized" : "standard"}
      style={
        participates
          ? {
              viewTransitionName: surfaceViewTransitionName(surface),
              viewTransitionClass: SURFACE_VIEW_TRANSITION_CLASS,
            }
          : undefined
      }
      className={cn(
        "absolute flex items-stretch justify-stretch transition-[top,right,bottom,left] duration-200 ease-out",
        maximized ? "inset-0 bg-canvas" : "inset-x-12 top-6 bottom-[112px]",
      )}
    >
      {surface.kind === "dmachine" ? (
        <div data-surface-window data-surface-id={id} className="relative h-full min-h-0 w-full">
          {windowControls}
          {/* The cost tab is host-owned and unsuppressible; a guest surface always carries it. */}
          <DmachineWindow
            model="GPT-5.6 Sol"
            cost="$0.00"
            fullBleed={maximized}
            className="h-full min-h-0 w-full"
          >
            {children}
          </DmachineWindow>
        </div>
      ) : (
        // Host surfaces get no cost tab — they are not guests, and nothing bills to them.
        // There is no Figma spec for host-window chrome yet; this mirrors the dMachine window
        // body so the two read as the same family.
        <div
          data-surface-window
          data-surface-id={id}
          data-tier="light"
          className={cn(
            "relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-canvas transition-[border-radius] duration-200 ease-out",
            maximized ? "rounded-none" : "rounded-lg shadow-[0px_0px_8px_0px_rgba(184,68,254,0.1)]",
          )}
        >
          {windowControls}
          <div
            data-surface-scrollport
            className={cn(
              "min-h-0 w-full flex-1 overflow-y-auto transition-[padding] duration-200 ease-out",
              maximized ? "px-[84px] pt-[76px] pb-[136px]" : "px-9 pt-[52px] pb-6",
            )}
          >
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
