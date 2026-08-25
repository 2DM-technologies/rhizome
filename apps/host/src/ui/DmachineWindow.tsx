import type { ReactNode } from "react";

import { cn } from "./cn.ts";

export interface DmachineWindowProps {
  /** Provider-qualified model driving this surface, e.g. "GPT-5.6 Sol". */
  model: string;
  /** Spend so far on this surface, already formatted. */
  cost: string;
  children: ReactNode;
  className?: string;
}

/**
 * Figma 4916:397 — the frame a dMachine runs inside.
 *
 * The cost tab is host chrome, not window decoration. `impl/concepts/sandboxing.md` §5 and
 * plan §7 both require a cost indicator the dMachine cannot suppress or spoof, so it is
 * drawn here, outside the surface the guest controls, and the guest's content is confined
 * to `children`. The window's top-right corner is squared (2px) because the tab sits in it.
 */
export function DmachineWindow({ model, cost, children, className }: DmachineWindowProps) {
  return (
    <div data-tier="light" className={cn("flex flex-col items-end", className)}>
      <div className="flex h-5 items-center justify-end rounded-t-sm rounded-b-[2px] bg-accent/90 px-3">
        <p className="text-caption font-sans text-on-accent whitespace-nowrap">
          {model} | <span className="font-bold">{cost}</span>
        </p>
      </div>
      <div
        className={cn(
          "flex min-h-0 w-full flex-col gap-5 overflow-hidden bg-canvas px-9 pt-7 pb-6",
          "rounded-[20px_2px_20px_20px] shadow-[0px_0px_8px_0px_rgba(184,68,254,0.1)]",
        )}
      >
        {children}
      </div>
    </div>
  );
}
