import { useEffect, useRef, useState, type CSSProperties } from "react";

import { cn } from "../ui/cn.ts";
import type { OrbVisualRecipe } from "./recipe.ts";
import { OrbFallback, OrbLoadingOverlay } from "./OrbFallback.tsx";
import { OrbRenderer, type OrbMotionMode, type OrbRendererOptions } from "./renderer.ts";

export interface ProceduralVibeOrbProps {
  recipe: OrbVisualRecipe;
  motion?: OrbMotionMode;
  className?: string;
  /** Useful while tuning; production callers normally let their container set both dimensions. */
  size?: number | string;
  label?: string;
  /** Interaction state supplied by an accessible parent, such as a focused card button. */
  active?: boolean;
  /** Shows a soft white pulse while the neutral pre-inference identity is being replaced. */
  loading?: boolean;
  /** Disable the CSS underlay when this canvas overlays an existing raster image. */
  fallback?: boolean;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return reduced;
}

/** Don't compile or attach an orb just because the pointer passed across a card. */
export function useOrbHover(hovered: boolean): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!hovered) {
      setSettled(false);
      return;
    }
    const timer = window.setTimeout(() => setSettled(true), 100);
    return () => window.clearTimeout(timer);
  }, [hovered]);
  return hovered && settled;
}

/**
 * One host-owned procedural orb. It retains a CSS still underneath the canvas so context loss and
 * unsupported WebGL never produce a missing identity mark.
 */
export function ProceduralVibeOrb({
  recipe,
  motion = "continuous",
  className,
  size,
  label,
  active = false,
  loading = false,
  fallback = true,
}: ProceduralVibeOrbProps) {
  const canvasHost = useRef<HTMLSpanElement>(null);
  const rendererRef = useRef<OrbRenderer>(null);
  const [rendererState, setRendererState] = useState<"pending" | "webgl" | "fallback">("pending");
  const reducedMotion = useReducedMotion();
  const icon = typeof size === "number" && size <= 48;
  const dimension = typeof size === "number" ? `${size}px` : size;
  const style = dimension
    ? ({ width: dimension, height: dimension } satisfies CSSProperties)
    : undefined;

  useEffect(() => {
    const host = canvasHost.current;
    if (!host) return;
    setRendererState("pending");
    try {
      const options: OrbRendererOptions = {
        motion,
        reducedMotion,
        onContextAvailabilityChange: (available: boolean) => {
          renderer.canvas.style.opacity = available ? "1" : "0";
          setRendererState(available ? "webgl" : "fallback");
        },
      };
      const renderer = icon
        ? OrbRenderer.forIcon(recipe, options)
        : new OrbRenderer(document.createElement("canvas"), recipe, options);
      const canvas = renderer.canvas;
      canvas.className = "absolute inset-0 size-full";
      canvas.setAttribute("aria-hidden", "true");
      canvas.style.opacity = "0";
      host.append(canvas);
      renderer.resize();
      rendererRef.current = renderer;
      return () => {
        renderer.destroy({ recycle: icon });
        canvas.remove();
        rendererRef.current = null;
      };
    } catch {
      setRendererState("fallback");
    }
  }, [icon]);

  useEffect(() => rendererRef.current?.setRecipe(recipe), [recipe, icon]);
  useEffect(() => rendererRef.current?.setMotion(motion), [motion, icon]);
  useEffect(() => rendererRef.current?.setReducedMotion(reducedMotion), [reducedMotion, icon]);
  useEffect(() => rendererRef.current?.setInteraction(active), [active, icon]);

  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-vibe-orb-renderer={rendererState}
      data-vibe-orb-motion={reducedMotion ? "reduced" : motion}
      className={cn("relative block shrink-0 touch-none select-none", className)}
      style={style}
    >
      <OrbFallback recipe={recipe} hidden={!fallback || rendererState === "webgl"} />
      <span ref={canvasHost} aria-hidden className="absolute inset-0 size-full" />
      {loading ? <OrbLoadingOverlay /> : null}
    </span>
  );
}
