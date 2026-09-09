import type { ReactNode } from "react";

import { cn } from "./cn.ts";

export interface LauncherItemProps {
  label: string;
  /** App art or emoji glyph. */
  icon: ReactNode;
  onSelect?: () => void;
  className?: string;
}

/**
 * Figma 4860:46 — icon + caption cell for the launcher popover
 * ("Start something new" / "Import Vibe" grids).
 */
export function LauncherItem({ label, icon, onSelect, className }: LauncherItemProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-18 shrink-0 flex-col items-center gap-1.5 rounded-sm bg-surface p-2",
        "transition-colors hover:bg-[#e7e7e2]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        className,
      )}
    >
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-sm bg-primary/8 text-[22px] leading-none text-primary"
      >
        {icon}
      </span>
      <span className="w-full text-center text-mono-label font-sans text-secondary">{label}</span>
    </button>
  );
}
