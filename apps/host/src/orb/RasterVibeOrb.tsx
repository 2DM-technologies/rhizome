import { useEffect, useRef, useState, type CSSProperties } from "react";

import { cn } from "../ui/cn.ts";
import { OrbFallback, OrbLoadingOverlay } from "./OrbFallback.tsx";
import { cachedOrbRasterSource, getOrbRasterSource, orbRasterKey } from "./raster.ts";
import type { OrbVisualRecipe } from "./recipe.ts";

interface RasterVibeOrbProps {
  recipe: OrbVisualRecipe;
  className?: string;
  size?: number | string;
  label?: string;
  loading?: boolean;
}

/** Small identities are images. Only visible, inferred identities request a raster capture. */
export function RasterVibeOrb({
  recipe,
  className,
  size,
  label,
  loading = false,
}: RasterVibeOrbProps) {
  const container = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<{ key: string; source: string | null }>();
  const key = orbRasterKey(recipe);

  useEffect(() => {
    if (!container.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(Boolean(entry?.isIntersecting)),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || loading) return;
    let current = true;
    // The key is the canonical recipe; unrelated query updates don't restart this request.
    void getOrbRasterSource(recipe).then(
      (source) => {
        if (current) setResult({ key, source });
      },
      () => {
        if (current) setResult({ key, source: null });
      },
    );
    return () => {
      current = false;
    };
  }, [key, visible, loading]);

  const src = loading
    ? undefined
    : result?.key === key
      ? result.source
      : cachedOrbRasterSource(key);
  const ready = Boolean(src);
  const dimension = typeof size === "number" ? `${size}px` : size;
  const style = dimension
    ? ({ width: dimension, height: dimension } satisfies CSSProperties)
    : undefined;

  return (
    <span
      ref={container}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-vibe-orb-renderer={ready ? "raster" : src === null ? "fallback" : "pending"}
      data-vibe-orb-motion="still"
      className={cn("relative block shrink-0 select-none", className)}
      style={style}
    >
      <OrbFallback recipe={recipe} hidden={ready} />
      {src ? (
        <img
          key={src}
          src={src}
          alt=""
          aria-hidden
          decoding="sync"
          draggable={false}
          onError={() => setResult({ key, source: null })}
          className="absolute inset-0 size-full object-contain"
        />
      ) : null}
      {loading ? <OrbLoadingOverlay /> : null}
    </span>
  );
}
