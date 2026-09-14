import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ProceduralVibeOrb, orbFallbackBackground } from "../src/orb/ProceduralVibeOrb.tsx";
import {
  MAX_ORB_COLORS,
  ORB_PRESETS,
  normalizeOrbRecipe,
  orbSeedVector,
} from "../src/orb/recipe.ts";
import {
  fallbackOrbRecipe,
  inferredOrbRecipeForVibe,
  orbRecipeForVibe,
  orbVisualForVibe,
  parseOrbVisualRecipe,
} from "../src/orb/vibeRecipe.ts";
import { ORB_SHADER_SOURCE } from "../src/orb/renderer.ts";

test("normalizes the draft renderer recipe into bounded inputs", () => {
  const normalized = normalizeOrbRecipe({
    ...ORB_PRESETS.bloom,
    seed: "",
    palette: [
      { color: "not-a-color" as `#${string}`, weight: -2 },
      ...Array.from({ length: 8 }, (_, index) => ({
        color: `#00000${index}` as `#${string}`,
        weight: 2,
      })),
    ],
    contrast: Number.POSITIVE_INFINITY,
    field: { ...ORB_PRESETS.bloom.field, warp: -0.5, grain: 1.5 },
  });

  expect(normalized.seed).toBe("rhizome");
  expect(normalized.palette).toHaveLength(MAX_ORB_COLORS);
  expect(normalized.palette[0]).toEqual({ color: "#7f5cff", weight: 0 });
  expect(normalized.palette[1]).toEqual({ color: "#000000", weight: 1 });
  expect(normalized.contrast).toBe(0);
  expect(normalized.field.warp).toBe(0);
  expect(normalized.field.grain).toBe(1);
});

test("fills a short palette and keeps it usable when every weight is zero", () => {
  const normalized = normalizeOrbRecipe({
    ...ORB_PRESETS.bloom,
    palette: [{ color: "#ABCDEF", weight: 0 }],
  });

  expect(normalized.palette).toEqual([
    { color: "#abcdef", weight: 1 },
    { color: "#abcdef", weight: 0 },
  ]);
});

test("turns identity strings into stable, distinct shader seeds", () => {
  expect(orbSeedVector("rnet://vibe/one")).toEqual(orbSeedVector("rnet://vibe/one"));
  expect(orbSeedVector("rnet://vibe/one")).not.toEqual(orbSeedVector("rnet://vibe/two"));
  expect(orbSeedVector("rnet://vibe/one").every((lane) => lane >= 0 && lane <= 1)).toBeTrue();
});

test("renders a usable CSS still before WebGL initializes", () => {
  const markup = renderToStaticMarkup(
    <ProceduralVibeOrb
      recipe={ORB_PRESETS.tideglass}
      motion="interaction"
      loading
      size={44}
      label="Trip references"
    />,
  );

  expect(markup).toContain('role="img"');
  expect(markup).toContain('aria-label="Trip references"');
  expect(markup).toContain('data-vibe-orb-renderer="pending"');
  expect(markup).toContain('data-vibe-orb-motion="interaction"');
  expect(markup).toContain("radial-gradient");
  expect(markup).toContain("conic-gradient");
  expect(markup).toContain("#17a9bd");
  expect(markup).toContain("data-vibe-orb-loading-overlay");
});

test("uses one continuous shader program for every visual personality", () => {
  expect(ORB_SHADER_SOURCE.fragment).toContain("uniform vec3 u_colors[6]");
  expect(ORB_SHADER_SOURCE.fragment).toContain("uniform float u_cellularity");
  expect(ORB_SHADER_SOURCE.fragment).toContain("uniform float u_reactivity");
  expect(ORB_SHADER_SOURCE.fragment).not.toContain("sampler2D");
  expect(Object.keys(ORB_PRESETS)).toEqual(["bloom", "ember", "tideglass", "lichen"]);
});

test("builds a palette-only fallback without depending on the shader", () => {
  const background = orbFallbackBackground(ORB_PRESETS.ember);
  expect(background).toContain("#13090b");
  expect(background).toContain("#df331f");
  expect(background).toContain("conic-gradient");
});

test("strictly reads persisted recipes and falls back deterministically by Vibe identity", () => {
  const recipe = { ...ORB_PRESETS.ember, seed: "0123456789abcdef0123456789abcdef" };
  const pending = orbVisualForVibe({ uri: "rnet://vibe/one", inferred: {} });
  const inferred = orbVisualForVibe({
    uri: "rnet://vibe/one",
    inferred: { "rhizome:vibe-orb": { model: "test", properties: recipe } },
  });
  expect(parseOrbVisualRecipe(recipe)).toEqual(recipe);
  expect(parseOrbVisualRecipe({ ...recipe, contrast: 2 })).toBeUndefined();
  expect(
    parseOrbVisualRecipe({ ...recipe, palette: [{ color: "red", weight: 1 }] }),
  ).toBeUndefined();
  expect(fallbackOrbRecipe("one")).toEqual(fallbackOrbRecipe("one"));
  expect(fallbackOrbRecipe("one").palette).toEqual([
    { color: "#aeb3b5", weight: 0.48 },
    { color: "#f4f4f1", weight: 0.32 },
    { color: "#596164", weight: 0.2 },
  ]);
  expect(fallbackOrbRecipe("one").seed).not.toBe(fallbackOrbRecipe("two").seed);
  expect(pending.loading).toBeTrue();
  expect(pending.recipe.surface).toEqual({
    gloss: 0.98,
    glow: 0.18,
    rim: 0.78,
    grainOverlay: 0.02,
  });
  expect(inferred).toEqual({ recipe, loading: false });
  expect(orbRecipeForVibe({ uri: "rnet://vibe/one", inferred: {} })).toEqual(
    fallbackOrbRecipe("rnet://vibe/one"),
  );
  expect(
    orbRecipeForVibe({
      uri: "rnet://vibe/one",
      inferred: { "rhizome:vibe-orb": { model: "test", properties: recipe } },
    }).seed,
  ).toBe(recipe.seed);
  expect(
    inferredOrbRecipeForVibe({
      inferred: { "rhizome:vibe-orb": { model: "test", properties: recipe } },
    }),
  ).toEqual(recipe);
  expect(inferredOrbRecipeForVibe({ inferred: {} })).toBeUndefined();
});
