import type { ReactNode } from "react";

import type { Theme } from "../theme.tsx";
import { cn } from "./cn.ts";
import { DesktopWallpaper } from "./DesktopWallpaper.tsx";

export interface DesktopProps {
  /** Windows and floating surfaces. */
  children?: ReactNode;
  /** The dock. Anchored to the bottom inset so every dock segment shares one baseline. */
  dock: ReactNode;
  /** Active app theme; omitted in static, CSS-themed previews. */
  theme?: Theme;
  className?: string;
}

/**
 * The shell ground: wallpaper with surfaces above it, dock pinned to the bottom
 * inset (48px sides, 24px bottom).
 */
export function Desktop({ children, dock, className, theme }: DesktopProps) {
  return (
    <div
      data-tier="control"
      data-theme={theme}
      className={cn("desktop-wallpaper relative h-full w-full overflow-hidden", className)}
    >
      <DesktopWallpaper theme={theme} />
      {children}
      <div data-shell-dock className="absolute right-12 bottom-6 left-12 z-20">
        {dock}
      </div>
    </div>
  );
}
