export const ORB_RECIPE_VERSION = 2 as const;
export const MAX_ORB_COLORS = 6;

/** Shared art direction: these controls belong to the renderer, not to inference. */
export const ORB_MATERIAL = {
  field: { roughness: 0.28, cellularity: 0.08 },
  surface: { gloss: 0.9, glow: 0.32, rim: 0.8, grainOverlay: 0.03 },
  motion: { pulseAmplitude: 0.035, pulsePeriod: 0.65 },
  response: { viscosity: 0.82, reactivity: 0.35, splash: 0.35, settle: 0.8 },
} as const;

export interface OrbPaletteStop {
  color: `#${string}`;
  weight: number;
}

/** Version 2 describes the interior of a Vibe's shared crystal-ball material. */
export interface OrbVisualRecipe {
  version: typeof ORB_RECIPE_VERSION;
  seed: string;
  palette: OrbPaletteStop[];
  contrast: number;
  field: {
    grain: number;
    warp: number;
    anisotropy: number;
  };
  energy: number;
}

export type OrbPresetName = "bloom" | "ember" | "tideglass" | "lichen";

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Even the liveliest Vibe stays within the same slow, fluid motion envelope. */
export function orbMotionForEnergy(value: number) {
  const energy = clampUnit(value);
  return {
    drift: 0.12 + energy * 0.18,
    turbulence: 0.1 + energy * 0.18,
    spin: 0.08 + energy * 0.14,
  };
}

function normalizeColor(value: string): `#${string}` {
  const match = /^#?([\da-f]{6})$/iu.exec(value.trim());
  return `#${match?.[1]?.toLowerCase() ?? "7f5cff"}`;
}

export function normalizeOrbRecipe(recipe: OrbVisualRecipe): OrbVisualRecipe {
  const palette = recipe.palette
    .slice(0, MAX_ORB_COLORS)
    .map(({ color, weight }) => ({ color: normalizeColor(color), weight: clampUnit(weight) }));

  while (palette.length < 2) {
    palette.push(palette.length === 0 ? { color: "#7f5cff", weight: 1 } : { ...palette[0]! });
  }

  if (palette.every(({ weight }) => weight === 0)) palette[0]!.weight = 1;

  return {
    version: ORB_RECIPE_VERSION,
    seed: recipe.seed || "rhizome",
    palette,
    contrast: clampUnit(recipe.contrast),
    field: {
      grain: clampUnit(recipe.field.grain),
      warp: clampUnit(recipe.field.warp),
      anisotropy: clampUnit(recipe.field.anisotropy),
    },
    energy: clampUnit(recipe.energy),
  };
}

/** Four distinct interiors sharing a polished crystal-ball surface. */
export const ORB_PRESETS: Readonly<Record<OrbPresetName, OrbVisualRecipe>> = {
  bloom: {
    version: ORB_RECIPE_VERSION,
    seed: "0198f2a1-bloom-7c92-a034-5d7e2f9a0c13",
    palette: [
      { color: "#3f1f91", weight: 0.22 },
      { color: "#a52bd6", weight: 0.28 },
      { color: "#ff5a92", weight: 0.3 },
      { color: "#ffb85b", weight: 0.2 },
    ],
    contrast: 0.34,
    field: { grain: 0.14, warp: 0.58, anisotropy: 0.2 },
    energy: 0.55,
  },
  ember: {
    version: ORB_RECIPE_VERSION,
    seed: "0198f2a1-ember-7c92-a034-5d7e2f9a0c13",
    palette: [
      { color: "#13090b", weight: 0.34 },
      { color: "#65121d", weight: 0.22 },
      { color: "#df331f", weight: 0.3 },
      { color: "#ffbf4b", weight: 0.14 },
    ],
    contrast: 0.9,
    field: { grain: 0.24, warp: 0.42, anisotropy: 0.72 },
    energy: 0.35,
  },
  tideglass: {
    version: ORB_RECIPE_VERSION,
    seed: "0198f2a1-tide-7c92-a034-5d7e2f9a0c13",
    palette: [
      { color: "#0b4970", weight: 0.2 },
      { color: "#17a9bd", weight: 0.34 },
      { color: "#b4e8d3", weight: 0.3 },
      { color: "#ffe37c", weight: 0.16 },
    ],
    contrast: 0.24,
    field: { grain: 0.12, warp: 0.62, anisotropy: 0.36 },
    energy: 0.85,
  },
  lichen: {
    version: ORB_RECIPE_VERSION,
    seed: "0198f2a1-lichen-7c92-a034-5d7e2f9a0c13",
    palette: [
      { color: "#26331f", weight: 0.2 },
      { color: "#68784a", weight: 0.34 },
      { color: "#a7ad6f", weight: 0.26 },
      { color: "#e1d7b6", weight: 0.2 },
    ],
    contrast: 0.58,
    field: { grain: 0.3, warp: 0.54, anisotropy: 0.12 },
    energy: 0.08,
  },
};

/** Stable four-lane hash suitable for shader offsets; equal seeds always produce equal orbs. */
export function orbSeedVector(seed: string): readonly [number, number, number, number] {
  let hash = 0x811c9dc5;
  const values: number[] = [];
  for (let lane = 0; lane < 4; lane += 1) {
    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index) + lane * 97;
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x7feb352d);
    hash ^= hash >>> 15;
    values.push((hash >>> 0) / 0xffffffff);
  }
  return values as [number, number, number, number];
}
