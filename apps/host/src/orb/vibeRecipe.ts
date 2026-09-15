import { storeTaskKey } from "@rhizome/store-contract";
import type { Vibe } from "@rnet/types";

import { PUSH_TASKS } from "../api/generated/push-tasks.ts";
import {
  ORB_RECIPE_VERSION,
  isOrbCharacter,
  normalizeOrbRecipe,
  type OrbVisualRecipe,
} from "./recipe.ts";

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
  surface: { depth: 0.5, glow: 0.3 },
  motion: { drift: 0.3, turbulence: 0.2, spin: 0.2 },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Strictly decode store-authored inference before it reaches WebGL uniforms. */
export function parseOrbVisualRecipe(value: unknown): OrbVisualRecipe | undefined {
  if (!isRecord(value) || value.version !== ORB_RECIPE_VERSION || typeof value.seed !== "string")
    return;
  if (!isOrbCharacter(value)) return;
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
  const entry = vibe.inferred?.[key];
  return entry?.confidence === 0 ? undefined : parseOrbVisualRecipe(entry?.properties);
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
