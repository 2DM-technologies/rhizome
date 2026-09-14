import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { cn } from "../ui/cn.ts";
import { normalizeOrbRecipe, type OrbVisualRecipe } from "./recipe.ts";
import { OrbRenderer, type OrbMotionMode } from "./renderer.ts";

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
}

function useReducedMotion(): boolean {
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

export function orbFallbackBackground(recipeInput: OrbVisualRecipe): string {
  const recipe = normalizeOrbRecipe(recipeInput);
  const colors = recipe.palette.map(({ color }) => color);
  const first = colors[0]!;
  const second = colors[1]!;
  const third = colors[2] ?? first;
  const fourth = colors[3] ?? second;
  return [
    `radial-gradient(ellipse at 36% 28%, rgb(255 250 245 / ${0.3 + recipe.surface.gloss * 0.4}) 0%, transparent 9%)`,
    `radial-gradient(ellipse at 33% 25%, rgb(255 255 255 / ${recipe.surface.gloss * 0.24}) 0%, transparent 32%)`,
    `radial-gradient(circle, transparent 57%, rgb(14 18 28 / 18%) 82%, rgb(235 247 255 / ${0.2 + recipe.surface.rim * 0.55}) 100%)`,
    `radial-gradient(circle at 30% 24%, color-mix(in srgb, ${fourth} 92%, white) 0%, transparent 34%)`,
    `radial-gradient(circle at 68% 72%, ${third} 0%, transparent 48%)`,
    `conic-gradient(from 28deg, ${first}, ${second}, ${third}, ${fourth}, ${first})`,
  ].join(", ");
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
}: ProceduralVibeOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<OrbRenderer>(null);
  const [rendererState, setRendererState] = useState<"pending" | "webgl" | "fallback">("pending");
  const reducedMotion = useReducedMotion();
  const fallback = useMemo(() => orbFallbackBackground(recipe), [recipe]);
  const dimension = typeof size === "number" ? `${size}px` : size;
  const style = dimension
    ? ({ width: dimension, height: dimension } satisfies CSSProperties)
    : undefined;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const renderer = new OrbRenderer(canvas, recipe, {
        motion,
        reducedMotion,
        onContextAvailabilityChange: (available) =>
          setRendererState(available ? "webgl" : "fallback"),
      });
      rendererRef.current = renderer;
      return () => {
        renderer.destroy();
        rendererRef.current = null;
      };
    } catch {
      setRendererState("fallback");
    }
  }, []);

  useEffect(() => rendererRef.current?.setRecipe(recipe), [recipe]);
  useEffect(() => rendererRef.current?.setMotion(motion), [motion]);
  useEffect(() => rendererRef.current?.setReducedMotion(reducedMotion), [reducedMotion]);
  useEffect(() => rendererRef.current?.setInteraction(active), [active]);

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
      <span
        aria-hidden
        className="absolute inset-[4.5%] rounded-full shadow-[inset_-0.18em_-0.2em_0.5em_rgb(0_0_0/24%),inset_0.1em_0.12em_0.36em_rgb(255_255_255/32%),0_0.16em_0.5em_rgb(0_0_0/18%)]"
        style={{ background: fallback, opacity: rendererState === "webgl" ? 0 : 1 }}
      />
      <canvas
        ref={canvasRef}
        aria-hidden
        className="absolute inset-0 size-full"
        style={{ opacity: rendererState === "webgl" ? 1 : 0 }}
      />
      {loading ? (
        <span
          aria-hidden
          data-vibe-orb-loading-overlay
          className="vibe-orb-loading-overlay pointer-events-none absolute inset-[4.5%] rounded-full bg-white"
        />
      ) : null}
    </span>
  );
}
