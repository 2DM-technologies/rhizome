import type { ReactNode } from "react";

import { cn } from "./cn.ts";
import { SearchIcon } from "./icons.tsx";

export interface LauncherSection {
  title: string;
  items: ReactNode;
}

export interface LauncherPanelProps {
  sections: readonly LauncherSection[];
  query: string;
  onQueryChange: (query: string) => void;
  className?: string;
}

/**
 * Figma 4916:450 — the "Start something new" popover. In the mockups this is what the dock's
 * search segment becomes when it takes focus: the field stays anchored at the dock baseline
 * and the panel unfolds above it, while the tray contracts to make room.
 */
export function LauncherPanel({ sections, query, onQueryChange, className }: LauncherPanelProps) {
  return (
    <div
      data-tier="dark"
      className={cn(
        "flex w-82 flex-col gap-6 rounded-md border border-white/80 bg-[rgba(51,51,51,0.9)] pt-4 font-sans",
        "backdrop-blur-[5px]",
        className,
      )}
    >
      <div className="flex flex-col gap-6 px-6">
        {sections.map((section) => (
          <div key={section.title} className="flex flex-col gap-2">
            <span className="flex items-center gap-1 text-body-lg font-medium text-white/90">
              {section.title}
              <span className="size-1.5 rounded-full bg-accent" aria-hidden />
            </span>
            <div className="flex flex-wrap gap-[22px]">{section.items}</div>
          </div>
        ))}
      </div>
      <div className="flex h-12 w-full items-center gap-[7px] rounded-md bg-[#333] px-6">
        <SearchIcon className="shrink-0 text-on-pill" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          aria-label="Search everything"
          className="min-w-0 flex-1 bg-transparent text-body-lg text-white outline-none placeholder:text-on-pill"
        />
      </div>
    </div>
  );
}
