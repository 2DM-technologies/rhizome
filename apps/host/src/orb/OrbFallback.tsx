import { useMemo } from "react";
import { ORB_MATERIAL, normalizeOrbRecipe, type OrbVisualRecipe } from "./recipe.ts";

export function orbFallbackBackground(recipeInput: OrbVisualRecipe): string {
  const recipe = normalizeOrbRecipe(recipeInput);
  const colors = recipe.palette.map(({ color }) => color);
  const first = colors[0]!;
  const second = colors[1]!;
  const third = colors[2] ?? first;
  const fourth = colors[3] ?? second;
  return [
    `radial-gradient(ellipse at 36% 28%, rgb(255 250 245 / ${0.3 + ORB_MATERIAL.surface.gloss * 0.4}) 0%, transparent 9%)`,
    `radial-gradient(ellipse at 33% 25%, rgb(255 255 255 / ${ORB_MATERIAL.surface.gloss * 0.24}) 0%, transparent 32%)`,
    `radial-gradient(circle, transparent 57%, rgb(14 18 28 / 18%) 82%, rgb(235 247 255 / ${0.2 + ORB_MATERIAL.surface.rim * 0.55}) 100%)`,
    `radial-gradient(circle at 30% 24%, color-mix(in srgb, ${fourth} 92%, white) 0%, transparent 34%)`,
    `radial-gradient(circle at 68% 72%, ${third} 0%, transparent 48%)`,
    `conic-gradient(from 28deg, ${first}, ${second}, ${third}, ${fourth}, ${first})`,
  ].join(", ");
}

export function OrbFallback({
  recipe,
  hidden = false,
}: {
  recipe: OrbVisualRecipe;
  hidden?: boolean;
}) {
  const background = useMemo(() => orbFallbackBackground(recipe), [recipe]);
  return (
    <span
      aria-hidden
      className="absolute inset-[4.5%] rounded-full shadow-[inset_-0.18em_-0.2em_0.5em_rgb(0_0_0/24%),inset_0.1em_0.12em_0.36em_rgb(255_255_255/32%),0_0.16em_0.5em_rgb(0_0_0/18%)]"
      style={{ background, opacity: hidden ? 0 : 1 }}
    />
  );
}

export function OrbLoadingOverlay() {
  return (
    <span
      aria-hidden
      data-vibe-orb-loading-overlay
      className="vibe-orb-loading-overlay pointer-events-none absolute inset-[4.5%] rounded-full bg-white"
    />
  );
}
