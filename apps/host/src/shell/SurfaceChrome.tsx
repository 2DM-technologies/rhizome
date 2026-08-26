import type { ReactNode } from "react";

import { DmachineWindow, cn } from "../ui/index.ts";
import type { Surface, ViewMode } from "./surfaces.ts";

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
 * Full screen is only a different box. The dock is not inside this tree, so it stays visible
 * either way, and switching modes never remounts the surface.
 */
export function SurfaceChrome({ surface, active, mode, children }: SurfaceChromeProps) {
  const full = active && mode === "full";
  return (
    <div
      hidden={!active}
      inert={!active}
      className={cn(
        "absolute inset-x-12 top-12 bottom-[124px] flex",
        full ? "items-stretch justify-stretch" : "items-start justify-center",
      )}
    >
      {surface.kind === "dmachine" ? (
        // The cost tab is host-owned and unsuppressible; a guest surface always carries it.
        <DmachineWindow
          model="GPT-5.6 Sol"
          cost="$0.00"
          className={cn("min-h-0", full ? "w-full" : "w-full max-w-[1186px]")}
        >
          {children}
        </DmachineWindow>
      ) : (
        // Host surfaces get no cost tab — they are not guests, and nothing bills to them.
        // There is no Figma spec for host-window chrome yet; this mirrors the dMachine window
        // body so the two read as the same family.
        <div
          data-tier="light"
          className={cn(
            "flex min-h-0 flex-col overflow-hidden rounded-lg bg-canvas px-9 pt-7 pb-6",
            "shadow-[0px_0px_8px_0px_rgba(184,68,254,0.1)]",
            full ? "w-full" : "w-full max-w-[1186px]",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
