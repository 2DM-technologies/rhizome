import { useEffect, useRef, useState, type CSSProperties } from "react";

import { cn } from "../ui/cn.ts";
import { OrbFallback, OrbLoadingOverlay } from "./OrbFallback.tsx";
import { getOrbRaster, orbRasterKey } from "./raster.ts";
import type { OrbVisualRecipe } from "./recipe.ts";

interface RasterVibeOrbProps {
  recipe: OrbVisualRecipe;
  className?: string;
  size?: number | string;
  label?: string;
  loading?: boolean;
}

function useBlobUrl(blob: Blob | undefined): string | undefined {
  const [value, setValue] = useState<{ blob: Blob; url: string }>();
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setValue({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return value?.blob === blob ? value?.url : undefined;
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
  const [result, setResult] = useState<{ key: string; blob: Blob | null }>();
  const [loadedSrc, setLoadedSrc] = useState<string>();
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
    void getOrbRaster(recipe).then(
      (blob) => {
        if (current) setResult({ key, blob });
      },
      () => {
        if (current) setResult({ key, blob: null });
      },
    );
    return () => {
      current = false;
    };
  }, [key, visible, loading]);

  const current = !loading && result?.key === key ? result : undefined;
  const src = useBlobUrl(current?.blob ?? undefined);
  const ready = Boolean(src && loadedSrc === src);
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
      data-vibe-orb-renderer={ready ? "raster" : current?.blob === null ? "fallback" : "pending"}
      data-vibe-orb-motion="still"
      className={cn("relative block shrink-0 select-none", className)}
      style={style}
    >
      <OrbFallback recipe={recipe} hidden={ready} />
      {src ? (
        <img
          src={src}
          alt=""
          aria-hidden
          decoding="async"
          draggable={false}
          onLoad={() => setLoadedSrc(src)}
          onError={() => setResult({ key, blob: null })}
          className="absolute inset-0 size-full object-contain"
          style={{ opacity: ready ? 1 : 0 }}
        />
      ) : null}
      {loading ? <OrbLoadingOverlay /> : null}
    </span>
  );
}
