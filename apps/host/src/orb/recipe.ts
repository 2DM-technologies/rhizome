export const ORB_RECIPE_VERSION = 1 as const;
export const MAX_ORB_COLORS = 6;

export interface OrbPaletteStop {
  color: `#${string}`;
  weight: number;
}

/** Version 1 of the host renderer input and the persisted `rhizome:vibe-orb` task properties. */
export interface OrbVisualRecipe {
  version: typeof ORB_RECIPE_VERSION;
  seed: string;
  palette: OrbPaletteStop[];
  contrast: number;
  field: {
    grain: number;
    roughness: number;
    warp: number;
    cellularity: number;
    anisotropy: number;
  };
  surface: {
    gloss: number;
    glow: number;
    rim: number;
    grainOverlay: number;
  };
  motion: {
    drift: number;
    turbulence: number;
    pulseAmplitude: number;
    pulsePeriod: number;
    spin: number;
  };
  response: {
    viscosity: number;
    reactivity: number;
    splash: number;
    settle: number;
  };
}

export type OrbPresetName = "bloom" | "ember" | "tideglass" | "lichen";

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
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
    ...recipe,
    version: ORB_RECIPE_VERSION,
    seed: recipe.seed || "rhizome",
    palette,
    contrast: clampUnit(recipe.contrast),
    field: {
      grain: clampUnit(recipe.field.grain),
      roughness: clampUnit(recipe.field.roughness),
      warp: clampUnit(recipe.field.warp),
      cellularity: clampUnit(recipe.field.cellularity),
      anisotropy: clampUnit(recipe.field.anisotropy),
    },
    surface: {
      gloss: clampUnit(recipe.surface.gloss),
      glow: clampUnit(recipe.surface.glow),
      rim: clampUnit(recipe.surface.rim),
      grainOverlay: clampUnit(recipe.surface.grainOverlay),
    },
    motion: {
      drift: clampUnit(recipe.motion.drift),
      turbulence: clampUnit(recipe.motion.turbulence),
      pulseAmplitude: clampUnit(recipe.motion.pulseAmplitude),
      pulsePeriod: clampUnit(recipe.motion.pulsePeriod),
      spin: clampUnit(recipe.motion.spin),
    },
    response: {
      viscosity: clampUnit(recipe.response.viscosity),
      reactivity: clampUnit(recipe.response.reactivity),
      splash: clampUnit(recipe.response.splash),
      settle: clampUnit(recipe.response.settle),
    },
  };
}

/** Four deliberately distant points in one parameter space, not renderer templates. */
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
    field: { grain: 0.28, roughness: 0.58, warp: 0.78, cellularity: 0.12, anisotropy: 0.2 },
    surface: { gloss: 0.62, glow: 0.72, rim: 0.38, grainOverlay: 0.16 },
    motion: { drift: 0.3, turbulence: 0.48, pulseAmplitude: 0.12, pulsePeriod: 0.58, spin: 0.14 },
    response: { viscosity: 0.74, reactivity: 0.48, splash: 0.58, settle: 0.68 },
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
    field: { grain: 0.54, roughness: 0.82, warp: 0.32, cellularity: 0.48, anisotropy: 0.72 },
    surface: { gloss: 0.24, glow: 0.42, rim: 0.22, grainOverlay: 0.42 },
    motion: { drift: 0.18, turbulence: 0.66, pulseAmplitude: 0.04, pulsePeriod: 0.42, spin: 0.08 },
    response: { viscosity: 0.46, reactivity: 0.72, splash: 0.86, settle: 0.34 },
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
    field: { grain: 0.12, roughness: 0.28, warp: 0.62, cellularity: 0.08, anisotropy: 0.36 },
    surface: { gloss: 0.92, glow: 0.38, rim: 0.78, grainOverlay: 0.05 },
    motion: { drift: 0.38, turbulence: 0.24, pulseAmplitude: 0.08, pulsePeriod: 0.76, spin: 0.3 },
    response: { viscosity: 0.88, reactivity: 0.34, splash: 0.32, settle: 0.84 },
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
    field: { grain: 0.72, roughness: 0.9, warp: 0.54, cellularity: 0.78, anisotropy: 0.12 },
    surface: { gloss: 0.12, glow: 0.2, rim: 0.46, grainOverlay: 0.66 },
    motion: { drift: 0.12, turbulence: 0.2, pulseAmplitude: 0.03, pulsePeriod: 0.65, spin: 0.04 },
    response: { viscosity: 0.92, reactivity: 0.2, splash: 0.28, settle: 0.9 },
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
