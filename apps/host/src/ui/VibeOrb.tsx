import { cn } from "./cn.ts";

export type VibeOrbSize = "sm" | "md" | "lg";

export interface VibeOrbProps {
  /** Orb artwork. One per vibe, app, or person — the mark is the identity. */
  src: string;
  alt?: string;
  size?: VibeOrbSize;
  className?: string;
}

const SIZES: Record<VibeOrbSize, string> = {
  sm: "size-5",
  md: "size-11",
  lg: "size-12",
};

/**
 * Figma 4860:42 — the signature Rhizome identity mark.
 * sm=20 inline · md=44 dock tray · lg=48 home/hero.
 */
export function VibeOrb({ src, alt = "", size = "md", className }: VibeOrbProps) {
  return (
    <img
      src={src}
      alt={alt}
      aria-hidden={alt === "" ? true : undefined}
      className={cn("shrink-0 object-cover", SIZES[size], className)}
    />
  );
}
