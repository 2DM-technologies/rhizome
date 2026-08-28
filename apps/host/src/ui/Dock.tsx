import { useEffect, useState, type ReactNode } from "react";

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

const SEGMENT_TRANSITION = "transition-[flex-grow,flex-basis,height] duration-100 ease-out";

function DockAppPresence({ children }: { children?: ReactNode }) {
  const [retained, setRetained] = useState(children);
  const present = children != null;

  useEffect(() => {
    if (children != null) {
      setRetained(children);
      return;
    }

    const timeout = window.setTimeout(() => setRetained(null), 100);
    return () => window.clearTimeout(timeout);
  }, [children]);

  return (
    <div
      data-dock-app-slot
      data-present={present ? "true" : "false"}
      inert={!present}
      aria-hidden={present ? undefined : true}
      className={cn("absolute bottom-0 left-0 h-17 w-17", !present && "pointer-events-none")}
    >
      <div
        data-dock-app-content
        className={cn(
          "absolute bottom-0 left-0 transition-[opacity,transform] duration-100 ease-out",
          present ? "scale-100 opacity-100" : "scale-75 opacity-0",
        )}
      >
        {children ?? retained}
      </div>
    </div>
  );
}

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

/** Figma 4916:337 — the translucent glass tray holding running apps, divider, and search. */
export function DockTray({ children, className }: DockTrayProps) {
  return (
    <div
      data-dock-tray
      className={cn(
        "relative h-16 min-w-0 flex-1 self-end rounded-md",
        // Not clipped: an expanding segment (the launcher) grows upward out of the tray, and
        // the active app card overhangs it.
        SEGMENT_TRANSITION,
        className,
      )}
    >
      {/* Keep the tray's filter off the launcher ancestor. Otherwise the tray creates a
          backdrop root and the launcher's own frost cannot sample the desktop behind it. */}
      <div
        data-dock-tray-backdrop
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-md bg-dock-tray backdrop-blur-[10px]"
      />
      <div className="relative z-10 flex h-full min-w-0 items-center gap-5 px-3">{children}</div>
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
  const appPresent = apps != null;

  return (
    <div className={cn("flex w-full items-end gap-[30px]", className)}>
      <DockSegment className="min-h-16">{leading}</DockSegment>
      <DockSegment grow={1} className="relative min-h-16">
        <DockAppPresence>{apps}</DockAppPresence>
        <div
          data-dock-tray-slot
          className={cn(
            "min-w-0 flex-1 transition-[margin-left] duration-100 ease-out",
            appPresent ? "ml-20" : "ml-0",
          )}
        >
          {tray}
        </div>
        {trailing ? <div className="ml-3 shrink-0">{trailing}</div> : null}
      </DockSegment>
    </div>
  );
}
