import { ORB_RECIPE_VERSION, type OrbVisualRecipe } from "@rhizome/store-contract/orb";
export * from "@rhizome/store-contract/orb";
export type OrbPresetName = "bloom" | "ember" | "tideglass" | "lichen";

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
    surface: { depth: 0.6, glow: 0.65 },
    motion: { drift: 0.4, turbulence: 0.25, spin: 0.25 },
  },
  ember: {
    version: ORB_RECIPE_VERSION,
    seed: "0198f2a1-ember-7c92-a034-5d7e2f9a0c13",
    palette: [
      { color: "#962c42", weight: 0.34 },
      { color: "#c23438", weight: 0.22 },
      { color: "#df331f", weight: 0.3 },
      { color: "#ffbf4b", weight: 0.14 },
    ],
    contrast: 0.9,
    field: { grain: 0.24, warp: 0.42, anisotropy: 0.72 },
    surface: { depth: 0.85, glow: 0.75 },
    motion: { drift: 0.3, turbulence: 0.75, spin: 0.1 },
  },
  tideglass: {
    version: ORB_RECIPE_VERSION,
    seed: "0198f2a1-tide-7c92-a034-5d7e2f9a0c13",
    palette: [
      { color: "#0b4970", weight: 0.2 },
      { color: "#17a9bd", weight: 0.34 },
      { color: "#70d9b5", weight: 0.3 },
      { color: "#ffe37c", weight: 0.16 },
    ],
    contrast: 0.24,
    field: { grain: 0.12, warp: 0.62, anisotropy: 0.36 },
    surface: { depth: 0.9, glow: 0.45 },
    motion: { drift: 0.7, turbulence: 0.2, spin: 0.7 },
  },
  lichen: {
    version: ORB_RECIPE_VERSION,
    seed: "0198f2a1-lichen-7c92-a034-5d7e2f9a0c13",
    palette: [
      { color: "#2a794c", weight: 0.2 },
      { color: "#50aa64", weight: 0.34 },
      { color: "#aad55e", weight: 0.26 },
      { color: "#e2bf53", weight: 0.2 },
    ],
    contrast: 0.58,
    field: { grain: 0.3, warp: 0.54, anisotropy: 0.12 },
    surface: { depth: 0.3, glow: 0.25 },
    motion: { drift: 0.08, turbulence: 0.08, spin: 0.02 },
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
