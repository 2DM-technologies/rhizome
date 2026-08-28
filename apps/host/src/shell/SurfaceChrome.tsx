import type { ReactNode } from "react";

import { DmachineWindow, cn } from "../ui/index.ts";
import { useSurfaceNavigation } from "./focus.ts";
import { useShellStore } from "./store.ts";
import { surfaceId, type Surface, type ViewMode } from "./surfaces.ts";

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
 * Maximized is only a different box. The dock is not inside this tree, so it stays visible
 * either way, and switching modes never remounts the surface.
 */
export function SurfaceChrome({ surface, active, mode, children }: SurfaceChromeProps) {
  const maximized = active && mode === "maximized";
  const launcherOpen = useShellStore((state) => state.launcherOpen);
  const { close } = useSurfaceNavigation();
  const closeControl = (
    <button
      type="button"
      aria-label="Close surface"
      onClick={() => close(surfaceId(surface))}
      className="absolute top-3 right-3 z-10 grid size-8 place-items-center rounded-pill bg-surface text-xl leading-none text-secondary transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span aria-hidden>×</span>
    </button>
  );
  return (
    <div
      hidden={!active}
      inert={!active || launcherOpen}
      aria-hidden={launcherOpen || undefined}
      data-view-mode={maximized ? "maximized" : "standard"}
      className={cn(
        "absolute bottom-[124px] flex items-stretch justify-stretch transition-[top,right,left] duration-200 ease-out",
        maximized ? "inset-x-6 top-6" : "inset-x-12 top-12",
      )}
    >
      {surface.kind === "dmachine" ? (
        <div data-surface-window className="relative h-full min-h-0 w-full">
          {closeControl}
          {/* The cost tab is host-owned and unsuppressible; a guest surface always carries it. */}
          <DmachineWindow model="GPT-5.6 Sol" cost="$0.00" className="h-full min-h-0 w-full">
            {children}
          </DmachineWindow>
        </div>
      ) : (
        // Host surfaces get no cost tab — they are not guests, and nothing bills to them.
        // There is no Figma spec for host-window chrome yet; this mirrors the dMachine window
        // body so the two read as the same family.
        <div
          data-surface-window
          data-tier="light"
          className={cn(
            "relative flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-canvas px-9 pt-7 pb-6",
            "shadow-[0px_0px_8px_0px_rgba(184,68,254,0.1)]",
            "w-full",
          )}
        >
          {closeControl}
          {children}
        </div>
      )}
    </div>
  );
}
