export const ORB_RECIPE_VERSION = 3 as const;
export const MAX_ORB_COLORS = 6;

/** Shared art direction: these controls belong to the renderer, not to inference. */
export const ORB_MATERIAL = {
  surface: { gloss: 0.9, rim: 0.8, grainOverlay: 0.03 },
  motion: { speedScale: 1.25, pulseAmplitude: 0.035, pulsePeriod: 0.65 },
  response: { viscosity: 0.82, reactivity: 0.35, splash: 0.35, settle: 0.8 },
} as const;

export interface OrbPaletteStop {
  color: `#${string}`;
  weight: number;
}

/** Version 3 describes the interior of a Vibe's shared crystal-ball material. */
export interface OrbCharacter {
  palette: OrbPaletteStop[];
  contrast: number;
  field: {
    grain: number;
    warp: number;
    anisotropy: number;
  };
  surface: { depth: number; glow: number };
  motion: { drift: number; turbulence: number; spin: number };
}

export interface OrbVisualRecipe extends OrbCharacter {
  version: typeof ORB_RECIPE_VERSION;
  seed: string;
}

export interface OrbIdentity extends OrbCharacter {
  version: 1;
}

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Independent expressive controls mapped into a slow glass-motion envelope. */
export function orbMotionForCharacter(motion: OrbCharacter["motion"]) {
  const { speedScale } = ORB_MATERIAL.motion;
  return {
    drift: (0.06 + clampUnit(motion.drift) * 0.5) * speedScale,
    turbulence: (0.02 + clampUnit(motion.turbulence) * 0.6) * speedScale,
    spin: clampUnit(motion.spin) * 0.5 * speedScale,
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
    surface: { depth: clampUnit(recipe.surface.depth), glow: clampUnit(recipe.surface.glow) },
    motion: {
      drift: clampUnit(recipe.motion.drift),
      turbulence: clampUnit(recipe.motion.turbulence),
      spin: clampUnit(recipe.motion.spin),
    },
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function unit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
function group(value: unknown, keys: string[]): boolean {
  return record(value) && keys.every((key) => unit(value[key]));
}

export function isOrbCharacter(value: unknown): value is OrbCharacter {
  return (
    record(value) &&
    Array.isArray(value.palette) &&
    value.palette.length >= 2 &&
    value.palette.length <= MAX_ORB_COLORS &&
    value.palette.every(
      (stop) =>
        record(stop) &&
        typeof stop.color === "string" &&
        /^#[\da-f]{6}$/iu.test(stop.color) &&
        unit(stop.weight),
    ) &&
    value.palette.some((stop) => stop.weight > 0) &&
    unit(value.contrast) &&
    group(value.field, ["grain", "warp", "anisotropy"]) &&
    group(value.surface, ["depth", "glow"]) &&
    group(value.motion, ["drift", "turbulence", "spin"])
  );
}

export function parseOrbIdentity(value: unknown): OrbIdentity | undefined {
  return record(value) && value.version === 1 && isOrbCharacter(value)
    ? (value as unknown as OrbIdentity)
    : undefined;
}

/** HSL is used for hue selection, never for averaging unrelated RGB channels. */
export function orbColorHsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map(
    (start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255,
  ) as [number, number, number];
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min;
  const lightness = (max + min) / 2;
  const hue =
    delta === 0
      ? 0
      : max === r
        ? ((g - b) / delta + 6) % 6
        : max === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4;
  return [hue * 60, delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1)), lightness];
}

function hslColor(hue: number, saturation: number, lightness: number): `#${string}` {
  const h = (((hue % 360) + 360) % 360) / 30;
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + h) % 12;
    return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

const hueDelta = (from: number, to: number) => ((to - from + 540) % 360) - 180;

/** Select a weighted hue family and accent, then give them a jewel-like tonal range. */
export function composeOrbPalette(stops: readonly OrbPaletteStop[]): OrbPaletteStop[] {
  // A fixed circular histogram keeps composition bounded for large collections.
  const histogram = new Float64Array(360);
  for (const { color, weight } of stops) {
    const [hue, saturation, lightness] = orbColorHsl(color);
    if (
      Number.isFinite(weight) &&
      weight > 0 &&
      saturation >= 0.3 &&
      lightness >= 0.12 &&
      lightness <= 0.88
    ) {
      const bin = Math.round(hue) % 360;
      histogram[bin] = histogram[bin]! + weight;
    }
  }
  const hues = [...histogram].flatMap((weight, hue) => (weight > 0 ? [{ hue, weight }] : []));
  if (!hues.length) return [];
  const support = (hue: number) =>
    hues.reduce(
      (sum, item) => sum + item.weight * Math.max(0, 1 - Math.abs(hueDelta(hue, item.hue)) / 55),
      0,
    );
  const dominant = [...hues].sort((a, b) => support(b.hue) - support(a.hue) || a.hue - b.hue)[0]!;
  const relatives = hues.filter((item) => Math.abs(hueDelta(dominant.hue, item.hue)) < 55);
  const familyWeight = relatives.reduce((sum, item) => sum + item.weight, 0);
  const hue =
    dominant.hue +
    relatives.reduce((sum, item) => sum + hueDelta(dominant.hue, item.hue) * item.weight, 0) /
      familyWeight;
  const accents = hues.filter((item) => Math.abs(hueDelta(hue, item.hue)) >= 55);
  const accent = accents.sort((a, b) => support(b.hue) - support(a.hue) || a.hue - b.hue)[0];
  const direction = accent ? Math.sign(hueDelta(hue, accent.hue)) : 1;
  // Limit the accent arc so a many-hued collection retains a coherent palette.
  const accentHue = hue + (accent ? Math.max(-100, Math.min(100, hueDelta(hue, accent.hue))) : 38);
  const total = hues.reduce((sum, item) => sum + item.weight, 0);
  const accentWeight = accent
    ? Math.min(0.26, Math.max(0.12, (support(accent.hue) / total) * 0.5))
    : 0.16;
  return [
    { color: hslColor(hue - direction * 18, 0.7, 0.34), weight: 0.22 },
    { color: hslColor(hue, 0.78, 0.5), weight: 0.34 },
    { color: hslColor(hue + direction * 22, 0.85, 0.64), weight: 0.44 - accentWeight },
    { color: hslColor(accentHue, 0.9, 0.65), weight: accentWeight },
  ].map((stop) => ({ ...stop, weight: Number(stop.weight.toFixed(6)) }));
}

export interface WeightedOrbCharacter {
  id: string;
  character: OrbCharacter;
  weight: number;
}

/** Each unique object gets one normalized vote; order and duplicate placements have no effect. */
export function composeVibeOrb(
  seed: string,
  input: readonly WeightedOrbCharacter[],
): OrbVisualRecipe | undefined {
  const objects = [...new Map(input.map((item) => [item.id, item])).values()]
    .filter(
      (item) => Number.isFinite(item.weight) && item.weight > 0 && isOrbCharacter(item.character),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const total = objects.reduce((sum, item) => sum + item.weight, 0);
  if (!total) return;
  const average = (read: (character: OrbCharacter) => number) =>
    Number(
      objects
        .reduce((sum, item) => sum + (read(item.character) * item.weight) / total, 0)
        .toFixed(6),
    );
  const palette = composeOrbPalette(
    objects.flatMap(({ character, weight }) => {
      const chromatic = character.palette.filter(({ color }) => {
        const [, saturation, lightness] = orbColorHsl(color);
        return saturation >= 0.3 && lightness >= 0.12 && lightness <= 0.88;
      });
      const paletteTotal = chromatic.reduce((sum, stop) => sum + stop.weight, 0);
      return chromatic.map((stop) => ({
        color: stop.color,
        weight: paletteTotal > 0 ? ((stop.weight / paletteTotal) * weight) / total : 0,
      }));
    }),
  );
  if (!palette.length) return;
  return {
    version: ORB_RECIPE_VERSION,
    seed,
    palette,
    contrast: average((c) => c.contrast),
    field: {
      grain: average((c) => c.field.grain),
      warp: average((c) => c.field.warp),
      anisotropy: average((c) => c.field.anisotropy),
    },
    surface: { depth: average((c) => c.surface.depth), glow: average((c) => c.surface.glow) },
    motion: {
      drift: average((c) => c.motion.drift),
      turbulence: average((c) => c.motion.turbulence),
      spin: average((c) => c.motion.spin),
    },
  };
}
