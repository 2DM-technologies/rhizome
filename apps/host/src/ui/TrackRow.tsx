import type { ReactNode } from "react";

import { cn } from "./cn.ts";
import { MoreIcon } from "./icons.tsx";

export interface TrackRowProps {
  title: string;
  subtitle?: string;
  /** 40px artwork. Falls back to the accent gradient when absent. */
  art?: ReactNode;
  onMore?: () => void;
  className?: string;
}

/** Figma 4859:281 — list row for tracks and entities. Fills the width of its parent. */
export function TrackRow({ title, subtitle, art, onMore, className }: TrackRowProps) {
  return (
    <div
      className={cn(
        "flex h-14 items-center gap-3 rounded-sm bg-surface pl-2.5 pr-3 py-2 font-sans",
        className,
      )}
    >
      <div className="size-10 shrink-0 overflow-hidden rounded-[4px] bg-linear-135 from-[#7d59ff] to-[#b845ff]">
        {art}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
        <span className="truncate text-body text-primary">{title}</span>
        {subtitle ? <span className="truncate text-caption text-secondary">{subtitle}</span> : null}
      </div>
      <button
        type="button"
        onClick={onMore}
        aria-label={`More options for ${title}`}
        className="shrink-0 text-tertiary transition-opacity hover:opacity-70"
      >
        <MoreIcon />
      </button>
    </div>
  );
}
