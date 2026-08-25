import type { ReactNode } from "react";

import { cn } from "./cn.ts";

/**
 * The dock is a fluid bento: a row of segments sharing one bottom edge, where any segment
 * can take space or height and the rest give it back. Two rules make that work —
 *
 *   1. Segments are laid out `items-end`, so a segment that expands grows UPWARD from the
 *      shared baseline instead of pushing the row around. This is what lets the agent panel
 *      (575 tall) and the home orb (48) occupy the same slot in the mockups.
 *   2. Exactly the segments marked `grow` absorb the slack, and every segment sets
 *      `min-w-0` so it may be squeezed below its content width rather than overflowing.
 *
 * `flex-grow` and `flex-basis` are animatable, so expansion and contraction are a
 * transition rather than a jump.
 */

const SEGMENT_TRANSITION = "transition-[flex-grow,flex-basis,height] duration-300 ease-out";

export interface DockSegmentProps {
  /** Share of the free space this segment absorbs. 0 keeps it at its natural width. */
  grow?: number;
  /** Fixed width for an expanded panel. Animates when it changes. */
  basis?: number | string;
  children: ReactNode;
  className?: string;
}

export function DockSegment({ grow = 0, basis = "auto", children, className }: DockSegmentProps) {
  return (
    <div
      style={{ flexGrow: grow, flexBasis: typeof basis === "number" ? `${basis}px` : basis }}
      className={cn("flex min-w-0 shrink items-center", SEGMENT_TRANSITION, className)}
    >
      {children}
    </div>
  );
}

export interface DockTrayProps {
  children: ReactNode;
  className?: string;
}

/** The flat grey bar. Holds running apps, a divider, and search. Gives way to its siblings. */
export function DockTray({ children, className }: DockTrayProps) {
  return (
    <div
      className={cn(
        "flex h-16 min-w-0 flex-1 items-center gap-5 rounded-md bg-dock-tray px-3",
        // Not clipped: an expanding segment (the launcher) grows upward out of the tray, and
        // the active app card overhangs it.
        "backdrop-blur-[5px]",
        SEGMENT_TRANSITION,
        className,
      )}
    >
      {children}
    </div>
  );
}

/** 1px × 54 rule between tray groups. */
export function DockDivider() {
  return <span className="h-[54px] w-px shrink-0 bg-dock-divider" aria-hidden />;
}

export interface DockProps {
  /** The home slot: the user's orb, or a panel that has expanded over it. */
  leading: ReactNode;
  /** Active apps, rendered between the home slot and the tray. */
  apps?: ReactNode;
  tray: ReactNode;
  /** Optional right-hand island. */
  trailing?: ReactNode;
  className?: string;
}

/**
 * Figma 4861:104 — desktop taskbar. 48px home orb, active app cards that overhang the tray,
 * then the tray itself.
 */
export function Dock({ leading, apps, tray, trailing, className }: DockProps) {
  return (
    <div className={cn("flex w-full items-end gap-[30px]", className)}>
      <DockSegment className="min-h-16">{leading}</DockSegment>
      <DockSegment grow={1} className="min-h-16 gap-3">
        {apps}
        {tray}
        {trailing}
      </DockSegment>
    </div>
  );
}
