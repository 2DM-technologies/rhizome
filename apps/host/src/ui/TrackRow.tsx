import type { ReactNode } from "react";

import { EntityRow } from "./EntityRow.tsx";
import { IconButton } from "./IconButton.tsx";
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
    <EntityRow
      variant="surface"
      className={className}
      title={title}
      titleClassName="text-body text-primary"
      subtitle={subtitle}
      leading={
        <div className="size-10 shrink-0 overflow-hidden rounded-[4px] bg-linear-135 from-[#7d59ff] to-[#b845ff]">
          {art}
        </div>
      }
      trailing={
        <IconButton
          onClick={onMore}
          aria-label={`More options for ${title}`}
          tone="ghost"
          size="sm"
        >
          <MoreIcon />
        </IconButton>
      }
    />
  );
}
