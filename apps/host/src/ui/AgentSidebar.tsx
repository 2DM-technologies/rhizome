import type { ReactNode } from "react";

import { cn } from "./cn.ts";

export interface AgentSidebarProps {
  /** Stream contents: messages, file chips, snippets, tool-call blocks. */
  children: ReactNode;
  /** The composer. Host-owned: a dMachine must not be able to draw its own. */
  composer: ReactNode;
  className?: string;
}

/**
 * Figma 4916:496 — the agent sidebar. Occupies the dock's home slot and grows upward from
 * the dock's baseline.
 *
 * It declares `data-tier="dark"`: the stream is content, and everything inside it reads the
 * inverted palette. That is the whole mechanism — the sidebar does not style its children,
 * it changes what their tokens mean.
 */
export function AgentSidebar({ children, composer, className }: AgentSidebarProps) {
  return (
    <div
      data-tier="dark"
      className={cn(
        "flex w-95 flex-col gap-[18px] overflow-hidden rounded-sm bg-pill font-sans",
        className,
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col items-start justify-end gap-4 overflow-y-auto px-5 py-4">
        {children}
      </div>
      {/*
        The panel colour wraps the composer as a 6px/8px frame rather than padding, so the
        composer sits flush to the panel's bottom edge exactly as drawn.

        The slot re-declares the light tier. The stream is content and stays dark; the
        composer is a control, and controls do not invert with the content they sit in —
        that is the tier-0 → tier-1 step the design system asks for, and it is why the
        composer reads as a raised white field against the dark panel.
      */}
      <div className="w-full border-r-6 border-b-8 border-l-6 border-pill">
        <div data-tier="light">{composer}</div>
      </div>
    </div>
  );
}
