import type { ReactNode } from "react";

import wallpaper from "../assets/brand/wallpaper.jpg";
import { cn } from "./cn.ts";

export interface DesktopProps {
  /** Windows and floating surfaces. */
  children?: ReactNode;
  /** The dock. Anchored to the bottom inset so every dock segment shares one baseline. */
  dock: ReactNode;
  className?: string;
}

/**
 * The shell ground: wallpaper under a white wash, surfaces above it, dock pinned to the
 * bottom inset (48px sides, 36px bottom — measured from the desktop frames).
 */
export function Desktop({ children, dock, className }: DesktopProps) {
  return (
    <div
      data-tier="light"
      className={cn("relative isolate h-full w-full overflow-hidden", className)}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <img src={wallpaper} alt="" className="size-full object-cover" />
        <div className="absolute inset-0 bg-linear-to-b from-white/65 via-white/70 via-[90.993%] to-white/80" />
      </div>
      {children}
      <div className="absolute right-12 bottom-9 left-12">{dock}</div>
    </div>
  );
}
