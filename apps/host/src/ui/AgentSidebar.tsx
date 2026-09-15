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
 * It declares `data-tier="content"`: the stream is content, and everything inside it reads the
 * inverted palette. That is the whole mechanism — the sidebar does not style its children,
 * it changes what their tokens mean.
 */
export function AgentSidebar({ children, composer, className }: AgentSidebarProps) {
  return (
    <div
      data-tier="content"
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

        The composer re-enters the control tier: light against a dark stream in light mode,
        dark against a light stream in dark mode. Role, not nesting depth, selects polarity.
      */}
      <div className="w-full border-r-6 border-b-8 border-l-6 border-pill">
        <div data-tier="control">{composer}</div>
      </div>
    </div>
  );
}
