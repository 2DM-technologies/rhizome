import { describe, expect, test } from "bun:test";
import sharp from "sharp";

import type { BlobStore } from "../src/blobs/types.ts";
import type { ContextObject, VibeContext } from "../src/push/context.ts";
import { vibeOrb } from "../src/push/tasks/vibe/vibe-orb/manifest.ts";
import {
  aggregateImagePalettes,
  measureImagePalette,
  prepareVibeOrbContext,
  transformVibeOrbOutput,
} from "../src/push/tasks/vibe/vibe-orb/palette.ts";
import { jsonSchema } from "../src/routes/contracts.ts";

async function swatch(colors: Array<[number, number, number, number]>): Promise<Uint8Array> {
  const bytes = Uint8Array.from(colors.flat());
  return new Uint8Array(
    await sharp(bytes, { raw: { width: colors.length, height: 1, channels: 4 } })
      .png()
      .toBuffer(),
  );
}

const output = {
  version: 1,
  seed: "ffffffffffffffffffffffffffffffff",
  palette: [
    { color: "#112233", weight: 0.4 },
    { color: "#445566", weight: 0.35 },
    { color: "#778899", weight: 0.25 },
  ],
  contrast: 0.5,
  field: { grain: 0.5, roughness: 0.5, warp: 0.5, cellularity: 0.5, anisotropy: 0.5 },
  surface: { gloss: 0.5, glow: 0.5, rim: 0.5, grainOverlay: 0.5 },
  motion: { drift: 0.2, turbulence: 0.3, pulseAmplitude: 0.1, pulsePeriod: 0.6, spin: 0.2 },
  response: { viscosity: 0.7, reactivity: 0.4, splash: 0.5, settle: 0.8 },
  confidence: 0.9,
};

describe("Vibe orb palette preparation", () => {
  test("asks the model to derive color from text semantics without constraining source meaning", () => {
    expect(vibeOrb.prompt.replace(/\s+/gu, " ")).toContain(
      "derive color from the subject, tone, and emotional register of text elements and properties",
    );
  });

  test("measures actual decoded pixels deterministically and preserves distant colors", async () => {
    const image = await swatch([
      [255, 0, 0, 255],
      [0, 0, 255, 255],
      [0, 255, 0, 0],
    ]);
    const first = await measureImagePalette(image);
    expect(await measureImagePalette(image)).toEqual(first);
    expect(first.map(({ color }) => color).sort()).toEqual(["#0000ff", "#ff0000"]);
    expect(first.reduce((sum, stop) => sum + stop.weight, 0)).toBeCloseTo(1, 3);
    expect(aggregateImagePalettes([first, [{ color: "#ff0000", weight: 1 }]])[0]?.color).toBe(
      "#ff0000",
    );
  });

  test("deduplicates shared images, skips invalid payloads, and derives a stable opaque seed", async () => {
    const image = await swatch([[18, 52, 86, 255]]);
    let reads = 0;
    const blobs = {
      async get(_namespace, key) {
        reads++;
        return key === "valid"
          ? { bytes: image, contentType: "image/png" }
          : { bytes: new Uint8Array() };
      },
      async put() {},
      async delete() {},
      async signedUrl() {
        return "";
      },
    } satisfies BlobStore;
    const element = (uuid: string, contentHash: string) => ({
      element: {
        uuid,
        kind: "image" as const,
        mime: "image/png",
        alt: null,
        inferred: {},
        contentHash,
        byteSize: image.byteLength,
      },
    });
    const record = (uuid: string, elements: ContextObject["elements"]): ContextObject => ({
      object: {
        uuid,
        type: "test",
        source: {
          properties: {},
          origins: [],
          ingest: { method: "authored", reproducible: false },
        },
        user: null,
        keys: {},
        inferred: {},
      },
      elements,
    });
    const records = [
      record("one", [element("shared", "valid"), element("invalid", "invalid")]),
      record("two", [element("shared", "valid")]),
    ];
    const input = {
      vibeUuid: "0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47",
      records,
      blobs,
      signal: new AbortController().signal,
    };
    const first = await prepareVibeOrbContext(input);
    expect(await prepareVibeOrbContext(input)).toEqual(first);
    expect(reads).toBe(4);
    expect(first.seed).toMatch(/^[a-f0-9]{32}$/);
    expect(first.image_palette).toEqual([{ color: "#123456", weight: 1 }]);
  });

  test("merges measured colors with semantic output and forces the operation seed", () => {
    const context = {
      title: "Test",
      objects: 1,
      types: [],
      elements: [],
      task_context: {
        seed: "0123456789abcdef0123456789abcdef",
        image_palette: [{ color: "#abcdef", weight: 1 }],
      },
    } satisfies VibeContext;
    const transformed = transformVibeOrbOutput(output, context);
    expect(transformed.seed).toBe(context.task_context.seed);
    expect(transformed.palette).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ color: "#abcdef" }),
        expect.objectContaining({ color: "#112233" }),
      ]),
    );
    expect(jsonSchema(vibeOrb.outputSchema).validate(transformed).ok).toBe(true);
  });
});
