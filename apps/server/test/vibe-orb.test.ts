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
  version: 2,
  seed: "ffffffffffffffffffffffffffffffff",
  palette: [
    { color: "#245c83", weight: 0.4 },
    { color: "#b94158", weight: 0.35 },
    { color: "#62976d", weight: 0.25 },
  ],
  contrast: 0.5,
  field: { grain: 0.5, warp: 0.5, anisotropy: 0.5 },
  energy: 0.55,
  confidence: 0.9,
};

describe("Vibe orb palette preparation", () => {
  test("accepts every prompt example and rejects generated material overrides", () => {
    const examples = [...vibeOrb.prompt.matchAll(/```json\n([\s\S]*?)\n```/gu)];
    expect(examples).toHaveLength(4);
    const schema = jsonSchema(vibeOrb.outputSchema);
    for (const [, example] of examples) {
      const recipe = { ...JSON.parse(example!), version: 2, seed: output.seed, confidence: 0.9 };
      expect(schema.validate(recipe).ok).toBeTrue();
      expect(schema.validate({ ...recipe, version: 1 }).ok).toBeFalse();
      expect(schema.validate({ ...recipe, energy: 1.1 }).ok).toBeFalse();
      for (const key of ["surface", "motion", "response"]) {
        expect(schema.validate({ ...recipe, [key]: {} }).ok).toBeFalse();
      }
      for (const key of ["roughness", "cellularity"]) {
        expect(
          schema.validate({ ...recipe, field: { ...recipe.field, [key]: 0.5 } }).ok,
        ).toBeFalse();
      }
    }
  });

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

  test("neutral image backgrounds cannot crowd out small areas of useful color", async () => {
    const image = await swatch([
      ...Array.from({ length: 8 }, () => [254, 254, 254, 255] as [number, number, number, number]),
      ...Array.from({ length: 5 }, () => [55, 55, 56, 255] as [number, number, number, number]),
      [0, 0, 0, 255],
      [153, 157, 156, 255],
      [244, 239, 223, 255],
      [22, 11, 16, 255],
      [23, 169, 189, 255],
      [223, 51, 31, 255],
    ]);
    const palette = await measureImagePalette(image);
    expect(palette.map(({ color }) => color).sort()).toEqual(["#17a9bd", "#df331f"]);
    expect(palette.reduce((sum, stop) => sum + stop.weight, 0)).toBeCloseTo(1, 3);
    expect(await measureImagePalette(image)).toEqual(palette);
  });

  test("an entirely neutral image leaves color selection to the semantic palette", async () => {
    const image = await swatch([
      [255, 255, 255, 255],
      [0, 0, 0, 255],
      [127, 127, 127, 255],
      [244, 239, 223, 255],
    ]);
    expect(await measureImagePalette(image)).toEqual([]);
    expect(
      aggregateImagePalettes([
        [{ color: "#fefefe", weight: 1 }],
        [{ color: "#373738", weight: 1 }],
        [{ color: "#17a9bd", weight: 1 }],
      ]),
    ).toEqual([{ color: "#17a9bd", weight: 1 }]);
    const transformed = transformVibeOrbOutput(output, {
      title: "Monochrome images",
      objects: 1,
      types: [],
      elements: [],
      task_context: {
        image_palette: [
          { color: "#fefefe", weight: 0.8 },
          { color: "#373738", weight: 0.2 },
        ],
      },
    });
    expect(transformed.palette).toEqual(output.palette);
    expect(jsonSchema(vibeOrb.outputSchema).validate(transformed).ok).toBeTrue();
  });

  test("the final blend excludes neutral measurements while retaining useful image hues", () => {
    const transformed = transformVibeOrbOutput(output, {
      title: "Images with paper backgrounds",
      objects: 1,
      types: [],
      elements: [],
      task_context: {
        image_palette: [
          { color: "#fefefe", weight: 0.7 },
          { color: "#373738", weight: 0.2 },
          { color: "#17a9bd", weight: 0.1 },
        ],
      },
    });
    const palette = transformed.palette as Array<{ color: string; weight: number }>;
    expect(palette.map(({ color }) => color)).toEqual(["#17a9bd", "#245c83", "#b94158", "#62976d"]);
    expect(palette.reduce((sum, stop) => sum + stop.weight, 0)).toBeCloseTo(1, 3);
    expect(jsonSchema(vibeOrb.outputSchema).validate(transformed).ok).toBeTrue();
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
        image_palette: [{ color: "#37a5d1", weight: 1 }],
      },
    } satisfies VibeContext;
    const transformed = transformVibeOrbOutput(output, context);
    expect(transformed.seed).toBe(context.task_context.seed);
    expect(transformed.palette).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ color: "#37a5d1" }),
        expect.objectContaining({ color: "#245c83" }),
      ]),
    );
    expect(jsonSchema(vibeOrb.outputSchema).validate(transformed).ok).toBe(true);
  });
});
