import type { ReactNode } from "react";

import { cn } from "./cn.ts";

export interface DmachineWindowProps {
  /** Provider-qualified model driving this surface, e.g. "GPT-5.6 Sol". */
  model: string;
  /** Spend so far on this surface, already formatted. */
  cost: string;
  /** Fill the desktop canvas while reserving content space for the overlaid dock. */
  fullBleed?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Figma 4916:397 — the frame a dMachine runs inside.
 *
 * The cost tab is host chrome, not window decoration. Implementation plan §7 requires a cost
 * indicator the dMachine cannot suppress or spoof, so it is drawn here, outside the surface
 * the guest controls. The guest's content is confined to `children`. The window's top-right
 * corner is squared (2px) because the tab sits in it.
 */
export function DmachineWindow({
  model,
  cost,
  fullBleed = false,
  children,
  className,
}: DmachineWindowProps) {
  return (
    <div
      data-tier="control"
      className={cn("flex flex-col items-end", fullBleed && "bg-canvas", className)}
    >
      <div className="flex h-5 items-center justify-end rounded-t-sm rounded-b-[2px] bg-accent/90 px-3">
        <p className="text-caption font-sans text-on-accent whitespace-nowrap">
          {model} | <span className="font-bold">{cost}</span>
        </p>
      </div>
      <div
        data-surface-scrollport
        className={cn(
          "min-h-0 w-full flex-1 overflow-y-auto bg-canvas transition-[padding,border-radius] duration-200 ease-out",
          fullBleed
            ? "rounded-none px-[84px] pt-[76px] pb-[136px]"
            : "rounded-[20px_2px_20px_20px] px-9 pt-[52px] pb-6 shadow-[0px_0px_8px_0px_rgba(184,68,254,0.1)]",
        )}
      >
        {children}
      </div>
    </div>
  );
}
