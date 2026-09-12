import type { ReactNode } from "react";

import wallpaper from "../assets/brand/wallpaper.png";
import { cn } from "./cn.ts";

export interface DesktopProps {
  /** Windows and floating surfaces. */
  children?: ReactNode;
  /** The dock. Anchored to the bottom inset so every dock segment shares one baseline. */
  dock: ReactNode;
  className?: string;
}

/**
 * The shell ground: wallpaper with surfaces above it, dock pinned to the bottom
 * inset (48px sides, 24px bottom).
 */
export function Desktop({ children, dock, className }: DesktopProps) {
  return (
    <div
      data-tier="light"
      style={{
        backgroundImage: `linear-gradient(rgb(255 255 255 / 75%), rgb(255 255 255 / 75%)), url(${wallpaper})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
      className={cn("relative h-full w-full overflow-hidden", className)}
    >
      {children}
      <div data-shell-dock className="absolute right-12 bottom-6 left-12 z-20">
        {dock}
      </div>
    </div>
  );
}
