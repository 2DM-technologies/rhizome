import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";

import { BackIcon, DmachineWindow, MaximizeIcon, RestoreIcon, cn } from "../ui/index.ts";
import { useSurfaceNavigation } from "./focus.ts";
import { surfaceId, type Surface, type ViewMode } from "./surfaces.ts";
import {
  clearDockTransitionTarget,
  dockOpenTransitionFor,
  type DockOpenTransition,
} from "./dockOpenMotion.ts";

interface SurfaceChromeProps {
  surface: Surface;
  active: boolean;
  mode: ViewMode;
  children: ReactNode;
}

/**
 * Geometry for one surface, and nothing else. Navigation replaces the current window by default.
 * When a caller explicitly keeps one open in the background, `hidden` removes it from layout and
 * `inert` from the tab order and accessibility tree while its DOM and scroll position survive.
 *
 * Maximized makes the surface itself full-bleed. Equal-and-opposite padding preserves the
 * standard window's content rectangle while the outer edges expand, so maximizing never moves
 * the document. The dock is a higher-stacking sibling and stays visible over the opaque canvas.
 */
export function SurfaceChrome({ surface, active, mode, children }: SurfaceChromeProps) {
  const id = surfaceId(surface);
  const maximized = active && mode === "maximized";
  // Reading the location makes the browser-owned history index reactive on both PUSH and POP.
  // React Router establishes index zero for the first in-app entry, so this never sends a
  // freshly opened Rhizome tab back to an unrelated site.
  const location = useLocation();
  const navigate = useNavigate();
  const historyIndex = (window.history.state as { idx?: unknown } | null)?.idx;
  const canGoBack = location.key !== "" && typeof historyIndex === "number" && historyIndex > 0;
  const elementRef = useRef<HTMLDivElement>(null);
  const transition = active ? dockOpenTransitionFor(surface) : null;
  const transitionRef = useRef<DockOpenTransition | null>(null);
  const openingRef = useRef<{
    animations: Animation[];
    key: number;
    target: { height: number; left: number; top: number; width: number };
  } | null>(null);
  if (transition && transitionRef.current?.key !== transition.key) {
    transitionRef.current = transition;
  }
  const transitionKey = transition?.key ?? null;

  useLayoutEffect(() => {
    const element = elementRef.current;
    const opening = transitionRef.current;
    if (!active || transitionKey === null || !element || opening?.key !== transitionKey) return;

    // React Strict Mode replays layout effects in development. Remove the first pass before
    // measuring again so its fill mode cannot make the animated source rect look like the target.
    const previous = openingRef.current;
    previous?.animations.forEach((animation) => animation.cancel());
    const measuredTarget = element.getBoundingClientRect();
    const target =
      previous?.key === opening.key
        ? previous.target
        : {
            height: measuredTarget.height,
            left: measuredTarget.left,
            top: measuredTarget.top,
            width: measuredTarget.width,
          };
    if (target.width === 0 || target.height === 0) {
      clearDockTransitionTarget(id, opening.key);
      transitionRef.current = null;
      return;
    }

    const translateX = opening.origin.left - target.left;
    const translateY = opening.origin.top - target.top;
    const scaleX = opening.origin.width / target.width;
    const scaleY = opening.origin.height / target.height;
    const endRadius = maximized ? "0px" : "20px";

    element.dataset.surfaceOpening = "true";
    element.dataset.surfaceOpeningSource = opening.source;

    const windowAnimation = element.animate(
      [
        {
          clipPath: "inset(0 round 999px)",
          transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${scaleX}, ${scaleY})`,
        },
        { clipPath: `inset(0 round ${endRadius})`, transform: "translate3d(0, 0, 0) scale(1, 1)" },
      ],
      {
        duration: 200,
        easing: "cubic-bezier(0.2, 0.9, 0.2, 1.04)",
        fill: "both",
      },
    );
    const content = element.querySelector<HTMLElement>("[data-surface-window]");
    const contentAnimation = content?.animate(
      [
        { offset: 0, opacity: 0 },
        { offset: 0.18, opacity: 0 },
        { offset: 0.55, opacity: 0.35 },
        { offset: 1, opacity: 1 },
      ],
      {
        delay: 12,
        duration: 180,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "both",
      },
    );
    const animations = contentAnimation ? [windowAnimation, contentAnimation] : [windowAnimation];
    const record = { animations, key: opening.key, target };
    openingRef.current = record;

    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (openingRef.current !== record) return;
      openingRef.current = null;
      delete element.dataset.surfaceOpening;
      delete element.dataset.surfaceOpeningSource;
      clearDockTransitionTarget(id, opening.key);
      transitionRef.current = null;
    });

    return () => animations.forEach((animation) => animation.cancel());
  }, [active, id, maximized, transitionKey]);

  const { close, toggleMaximized } = useSurfaceNavigation();
  const windowTopBar = (
    <div
      data-window-top-bar
      className="pointer-events-none absolute inset-x-3 top-3 z-10 flex items-center justify-between"
    >
      <button
        type="button"
        aria-label="Back"
        disabled={!canGoBack}
        onClick={() => navigate(-1)}
        className="pointer-events-auto grid size-8 place-items-center rounded-pill bg-surface text-secondary transition-[color,opacity] hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
      >
        <BackIcon />
      </button>
      <div data-window-controls className="pointer-events-auto flex items-center gap-1">
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
    </div>
  );
  return (
    <div
      ref={elementRef}
      hidden={!active}
      inert={!active}
      aria-hidden={!active || undefined}
      data-surface-id={id}
      data-view-mode={maximized ? "maximized" : "standard"}
      className={cn(
        "absolute flex items-stretch justify-stretch transition-[top,right,bottom,left] duration-200 ease-out",
        maximized ? "inset-0 bg-canvas" : "inset-x-12 top-6 bottom-[112px]",
      )}
    >
      {surface.kind === "dmachine" ? (
        <div data-surface-window data-surface-id={id} className="relative h-full min-h-0 w-full">
          {windowTopBar}
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
          {windowTopBar}
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
