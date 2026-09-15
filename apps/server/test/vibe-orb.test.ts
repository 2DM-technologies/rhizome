import { describe, expect, test } from "bun:test";
import {
  composeVibeOrb,
  composeOrbPalette,
  orbColorHsl,
  parseOrbIdentity,
  type OrbIdentity,
} from "@rhizome/store-contract/orb";
import { orbIdentity } from "../src/push/tasks/object/orb-identity/manifest.ts";
import { vibeOrb } from "../src/push/tasks/vibe/vibe-orb/manifest.ts";
import { prepareVibeOrbContext, deriveVibeOrb } from "../src/push/tasks/vibe/vibe-orb/palette.ts";
import { jsonSchema } from "../src/routes/contracts.ts";
import type { ContextObject, VibeContext } from "../src/push/context.ts";
import type { BlobStore } from "../src/blobs/types.ts";

const examples = [...orbIdentity.prompt.matchAll(/```json\n([\s\S]*?)\n```/gu)].map((match) =>
  JSON.parse(match[1]!),
);
const bloom = examples[0] as OrbIdentity;
const tide = examples[2] as OrbIdentity;
const contribution = (id: string, character = bloom, weight = 1) => ({ id, character, weight });

describe("object-derived Vibe orbs", () => {
  test("all art-direction examples satisfy the object schema; renderer-only controls are rejected", () => {
    expect(examples).toHaveLength(4);
    for (const example of examples) {
      expect(jsonSchema(orbIdentity.outputSchema).validate(example).ok).toBeTrue();
      expect(
        jsonSchema(orbIdentity.outputSchema).validate({ ...example, seed: "model-seed" }).ok,
      ).toBeFalse();
      expect(
        jsonSchema(orbIdentity.outputSchema).validate({
          ...example,
          surface: { ...example.surface, gloss: 0 },
        }).ok,
      ).toBeFalse();
    }
    expect(orbIdentity.prompt).toContain("never use other objects in the batch");
  });
  test("averages independent controls with explicit object weights", () => {
    const orb = composeVibeOrb("seed", [contribution("a"), contribution("b", tide, 3)])!;
    expect(orb.motion.drift).toBeCloseTo((bloom.motion.drift + tide.motion.drift * 3) / 4);
    expect(orb.motion.turbulence).toBeCloseTo(
      (bloom.motion.turbulence + tide.motion.turbulence * 3) / 4,
    );
    expect(orb.surface.depth).toBeCloseTo((bloom.surface.depth + tide.surface.depth * 3) / 4);
    expect(orb.field.anisotropy).toBeCloseTo(
      (bloom.field.anisotropy + tide.field.anisotropy * 3) / 4,
    );
    expect(orb.motion.drift).not.toBe(orb.motion.turbulence);
    expect(
      jsonSchema(vibeOrb.outputSchema).validate({ ...orb, seed: "a".repeat(32), confidence: 1 }).ok,
    ).toBeTrue();
  });
  test("order, duplicate placements, and palette weight magnitude do not change influence", () => {
    const a = contribution("a"),
      b = contribution("b", tide);
    const expected = composeVibeOrb("seed", [a, b]);
    expect(composeVibeOrb("seed", [b, a, a])).toEqual(expected);
    expect(
      composeVibeOrb("seed", [
        {
          ...a,
          character: {
            ...bloom,
            palette: bloom.palette.map((p) => ({ ...p, weight: p.weight / 2 })),
          },
        },
        b,
      ]),
    ).toEqual(expected);
    expect(composeVibeOrb("seed", [a, { ...b, weight: 0 }])).toEqual(composeVibeOrb("seed", [a]));
    expect(composeVibeOrb("another-seed", [a, b])?.palette).toEqual(expected?.palette);
  });
  test("opposing colors stay chromatic, with a normalized bounded palette", () => {
    const palette = composeOrbPalette([
      { color: "#1562d4", weight: 1 },
      { color: "#ee812b", weight: 1 },
      { color: "#31b873", weight: 1 },
    ]);
    expect(palette).toHaveLength(4);
    expect(palette.reduce((sum, c) => sum + c.weight, 0)).toBeCloseTo(1, 6);
    for (const { color } of palette) {
      const [, saturation, lightness] = orbColorHsl(color);
      expect(saturation).toBeGreaterThan(0.65);
      expect(lightness).toBeGreaterThan(0.3);
      expect(lightness).toBeLessThan(0.7);
    }
  });
  test("white, black, and neutral backgrounds never displace the chromatic family", () => {
    const color = { color: "#17a9bd" as const, weight: 0.01 };
    expect(
      composeOrbPalette([
        color,
        { color: "#fefefe", weight: 10 },
        { color: "#373738", weight: 10 },
        { color: "#879b9a", weight: 10 },
      ]),
    ).toEqual(composeOrbPalette([color]));
    expect(composeOrbPalette([{ color: "#ffffff", weight: 1 }])).toEqual([]);
  });
  test("red hues across the circular boundary cluster as red, and changing object counts changes the family", () => {
    const red = composeOrbPalette([
      { color: "#ff0022", weight: 1 },
      { color: "#ff2200", weight: 1 },
    ]);
    const [hue] = orbColorHsl(red[1]!.color);
    expect(Math.min(hue, 360 - hue)).toBeLessThan(8);
    expect(
      composeVibeOrb("seed", [contribution("a", bloom, 10), contribution("b", tide)])?.palette,
    ).not.toEqual(
      composeVibeOrb("seed", [contribution("a"), contribution("b", tide, 10)])?.palette,
    );
  });
  test("rejects malformed identities and ignores invalid or absent contributions", () => {
    expect(parseOrbIdentity({ ...bloom, version: 2 })).toBeUndefined();
    expect(
      parseOrbIdentity({ ...bloom, motion: { ...bloom.motion, spin: Number.NaN } }),
    ).toBeUndefined();
    expect(
      parseOrbIdentity({ ...bloom, palette: bloom.palette.map((p) => ({ ...p, weight: 0 })) }),
    ).toBeUndefined();
    expect(composeVibeOrb("seed", [])).toBeUndefined();
    expect(composeVibeOrb("seed", [contribution("bad", bloom, Number.NaN)])).toBeUndefined();
  });
  test("prepares only saved distinct object identities, with a stable seed and no blob reads", async () => {
    const record = (uuid: string, properties?: OrbIdentity) =>
      ({
        object: { uuid, inferred: properties ? { "rhizome:orb-identity": { properties } } : {} },
        elements: [],
      }) as unknown as ContextObject;
    const a = record("a", bloom),
      b = record("b", tide);
    const input = {
      vibeUuid: "vibe",
      records: [a, b, a, record("missing")],
      blobs: {
        get: () => {
          throw new Error("No image reads allowed");
        },
      } as unknown as BlobStore,
      signal: new AbortController().signal,
    };
    const task_context = await prepareVibeOrbContext(input);
    const output = deriveVibeOrb({ task_context } as VibeContext);
    expect(output.confidence).toBeCloseTo(2 / 3);
    expect(output.seed).toMatch(/^[a-f0-9]{32}$/);
    expect(jsonSchema(vibeOrb.outputSchema).validate(output).ok).toBeTrue();
    expect(await prepareVibeOrbContext({ ...input, records: [record("missing"), b, a] })).toEqual(
      task_context,
    );
    const empty = deriveVibeOrb({
      task_context: await prepareVibeOrbContext({ ...input, records: [] }),
    } as VibeContext);
    expect(empty.confidence).toBe(0);
    expect(jsonSchema(vibeOrb.outputSchema).validate(empty).ok).toBeTrue();
  });
});
