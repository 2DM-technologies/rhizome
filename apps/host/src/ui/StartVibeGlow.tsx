import { useId } from "react";

/** Fine grain over two continuous, opposing color currents. */
export function StartVibeGlow() {
  const grainId = useId();
  return (
    <span className="start-vibe-glow" aria-hidden="true">
      <svg className="start-vibe-grain" width="100%" height="100%">
        <defs>
          <filter id={grainId} x="0" y="0" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.85"
              numOctaves="3"
              seed="8"
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </defs>
        <rect width="100%" height="100%" filter={`url(#${grainId})`} />
      </svg>
    </span>
  );
}
