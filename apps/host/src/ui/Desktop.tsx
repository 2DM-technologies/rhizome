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
 * The shell ground: wallpaper under a white wash, surfaces above it, dock pinned to the bottom
 * inset (48px sides, 36px bottom — measured from the desktop frames).
 *
 * The wash is a second background layer rather than an overlay element. CSS composites the
 * gradient over the image in one declaration, so the ground is a single node with no extra
 * element to keep out of the accessibility tree and no stacking context to manage.
 */
const GROUND = `linear-gradient(
    to bottom,
    rgba(255, 255, 255, 0.65),
    rgba(255, 255, 255, 0.7) 90.993%,
    rgba(255, 255, 255, 0.8)
  ), url(${wallpaper})`;

export function Desktop({ children, dock, className }: DesktopProps) {
  return (
    <div
      data-tier="light"
      style={{ backgroundImage: GROUND, backgroundSize: "cover", backgroundPosition: "center" }}
      className={cn("relative h-full w-full overflow-hidden", className)}
    >
      {children}
      <div data-shell-dock className="absolute right-12 bottom-9 left-12">
        {dock}
      </div>
    </div>
  );
}
