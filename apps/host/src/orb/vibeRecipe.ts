import { storeTaskKey } from "@rhizome/store-contract";
import type { Vibe } from "@rnet/types";

import { PUSH_TASKS } from "../api/generated/push-tasks.ts";
import { ORB_RECIPE_VERSION, normalizeOrbRecipe, type OrbVisualRecipe } from "./recipe.ts";

const PRE_INFERENCE_ORB_RECIPE: OrbVisualRecipe = {
  version: ORB_RECIPE_VERSION,
  seed: "pre-inference",
  palette: [
    { color: "#aeb3b5", weight: 0.48 },
    { color: "#f4f4f1", weight: 0.32 },
    { color: "#596164", weight: 0.2 },
  ],
  contrast: 0.2,
  field: { grain: 0.08, warp: 0.32, anisotropy: 0.18 },
  energy: 0.45,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function scalarGroup(value: unknown, keys: readonly string[]): value is Record<string, number> {
  return isRecord(value) && keys.every((key) => unit(value[key]));
}

/** Strictly decode store-authored inference before it reaches WebGL uniforms. */
export function parseOrbVisualRecipe(value: unknown): OrbVisualRecipe | undefined {
  if (!isRecord(value) || value.version !== ORB_RECIPE_VERSION || typeof value.seed !== "string")
    return;
  if (
    !Array.isArray(value.palette) ||
    value.palette.length < 2 ||
    value.palette.length > 6 ||
    !value.palette.every(
      (stop) =>
        isRecord(stop) &&
        typeof stop.color === "string" &&
        /^#[\da-f]{6}$/iu.test(stop.color) &&
        unit(stop.weight),
    ) ||
    !unit(value.contrast) ||
    !scalarGroup(value.field, ["grain", "warp", "anisotropy"]) ||
    !unit(value.energy)
  )
    return;
  return normalizeOrbRecipe(value as unknown as OrbVisualRecipe);
}

/** A neutral identity while the store's semantic recipe is absent or still running. */
export function fallbackOrbRecipe(seed: string): OrbVisualRecipe {
  return normalizeOrbRecipe({ ...PRE_INFERENCE_ORB_RECIPE, seed });
}

export function inferredOrbRecipeForVibe(
  vibe: Pick<Vibe, "inferred">,
): OrbVisualRecipe | undefined {
  const key = storeTaskKey(PUSH_TASKS.vibe["vibe-orb"].name);
  return parseOrbVisualRecipe(vibe.inferred?.[key]?.properties);
}

export function orbVisualForVibe(vibe: Pick<Vibe, "uri" | "inferred">): {
  recipe: OrbVisualRecipe;
  loading: boolean;
} {
  const inferred = inferredOrbRecipeForVibe(vibe);
  return inferred
    ? { recipe: inferred, loading: false }
    : { recipe: fallbackOrbRecipe(vibe.uri), loading: true };
}

export function orbRecipeForVibe(vibe: Pick<Vibe, "uri" | "inferred">): OrbVisualRecipe {
  return orbVisualForVibe(vibe).recipe;
}
