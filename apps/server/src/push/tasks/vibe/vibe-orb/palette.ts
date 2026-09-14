import sharp from "sharp";

import { imageDimensions } from "../../../../inference/image.ts";
import type { PrepareVibeContextInput, TaskOutput } from "../../../task-catalog.ts";
import type { VibeContext } from "../../../context.ts";

const MAX_IMAGES = 12;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_MEASURED_COLORS = 4;
const SAMPLE_EDGE = 32;
const SUPPORTED_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export interface MeasuredColor {
  color: `#${string}`;
  weight: number;
}

interface ColorBucket {
  red: number;
  green: number;
  blue: number;
  score: number;
}

function channelHex(value: number): string {
  return Math.round(value).toString(16).padStart(2, "0");
}

function colorHex(bucket: ColorBucket): `#${string}` {
  const divisor = Math.max(bucket.score, Number.EPSILON);
  return `#${channelHex(bucket.red / divisor)}${channelHex(bucket.green / divisor)}${channelHex(bucket.blue / divisor)}`;
}

function colorDistance(left: ColorBucket, right: ColorBucket): number {
  const leftDivisor = Math.max(left.score, Number.EPSILON);
  const rightDivisor = Math.max(right.score, Number.EPSILON);
  return Math.hypot(
    left.red / leftDivisor - right.red / rightDivisor,
    left.green / leftDivisor - right.green / rightDivisor,
    left.blue / leftDivisor - right.blue / rightDivisor,
  );
}

function rankBuckets(buckets: Iterable<ColorBucket>, limit: number): MeasuredColor[] {
  const ranked = [...buckets].sort(
    (left, right) => right.score - left.score || colorHex(left).localeCompare(colorHex(right)),
  );
  const selected: ColorBucket[] = [];
  for (const bucket of ranked) {
    if (selected.length >= limit) break;
    if (!selected.length || selected.every((other) => colorDistance(bucket, other) >= 42))
      selected.push(bucket);
  }
  for (const bucket of ranked) {
    if (selected.length >= limit) break;
    if (!selected.includes(bucket)) selected.push(bucket);
  }
  const total = selected.reduce((sum, bucket) => sum + bucket.score, 0) || 1;
  return selected.map((bucket) => ({
    color: colorHex(bucket),
    weight: Number((bucket.score / total).toFixed(4)),
  }));
}

/** Decode a bounded thumbnail and measure a deterministic, diversity-preserving color histogram. */
export async function measureImagePalette(bytes: Uint8Array): Promise<MeasuredColor[]> {
  const { data, info } = await sharp(bytes, {
    animated: false,
    failOn: "error",
    limitInputPixels: 16_777_216,
  })
    .rotate()
    .resize(SAMPLE_EDGE, SAMPLE_EDGE, { fit: "inside", withoutEnlargement: true })
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const buckets = new Map<number, ColorBucket>();
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const red = data[offset] ?? 0;
    const green = data[offset + 1] ?? 0;
    const blue = data[offset + 2] ?? 0;
    const alpha = data[offset + 3] ?? 255;
    if (alpha < 48) continue;
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const saturation = maximum === 0 ? 0 : (maximum - minimum) / maximum;
    const score = (alpha / 255) * (0.45 + saturation * 0.55);
    const key = (red >> 4) * 256 + (green >> 4) * 16 + (blue >> 4);
    const bucket = buckets.get(key) ?? { red: 0, green: 0, blue: 0, score: 0 };
    bucket.red += red * score;
    bucket.green += green * score;
    bucket.blue += blue * score;
    bucket.score += score;
    buckets.set(key, bucket);
  }
  return rankBuckets(buckets.values(), MAX_MEASURED_COLORS);
}

export function aggregateImagePalettes(palettes: readonly MeasuredColor[][]): MeasuredColor[] {
  const buckets = new Map<number, ColorBucket>();
  for (const palette of palettes) {
    for (const stop of palette) {
      const red = Number.parseInt(stop.color.slice(1, 3), 16);
      const green = Number.parseInt(stop.color.slice(3, 5), 16);
      const blue = Number.parseInt(stop.color.slice(5, 7), 16);
      const score = stop.weight / Math.max(1, palettes.length);
      const key = (red >> 4) * 256 + (green >> 4) * 16 + (blue >> 4);
      const bucket = buckets.get(key) ?? { red: 0, green: 0, blue: 0, score: 0 };
      bucket.red += red * score;
      bucket.green += green * score;
      bucket.blue += blue * score;
      bucket.score += score;
      buckets.set(key, bucket);
    }
  }
  return rankBuckets(buckets.values(), MAX_MEASURED_COLORS);
}

function stableSeed(vibeUuid: string): string {
  return new Bun.CryptoHasher("sha256")
    .update(`rhizome:vibe-orb:${vibeUuid}`)
    .digest("hex")
    .slice(0, 32);
}

export async function prepareVibeOrbContext({
  vibeUuid,
  records,
  blobs,
  signal,
}: PrepareVibeContextInput): Promise<Record<string, unknown>> {
  const images = new Map<string, { contentHash: string; byteSize: number; mime: string }>();
  for (const record of records) {
    for (const { element } of record.elements) {
      if (
        images.size >= MAX_IMAGES ||
        element.kind !== "image" ||
        !SUPPORTED_IMAGE_MIMES.has(element.mime) ||
        !element.contentHash ||
        element.byteSize === undefined ||
        element.byteSize <= 0 ||
        element.byteSize > MAX_IMAGE_BYTES
      )
        continue;
      images.set(element.uuid, {
        contentHash: element.contentHash,
        byteSize: element.byteSize,
        mime: element.mime,
      });
    }
  }
  const palettes: MeasuredColor[][] = [];
  for (const image of images.values()) {
    if (signal.aborted) throw signal.reason ?? new Error("Orb palette measurement aborted");
    const payload = await blobs.get("elements", image.contentHash, signal);
    if (
      !payload ||
      payload.bytes.byteLength > MAX_IMAGE_BYTES ||
      !imageDimensions(image.mime, payload.bytes)
    )
      continue;
    try {
      const palette = await measureImagePalette(payload.bytes);
      if (palette.length) palettes.push(palette);
    } catch {
      // A malformed or unsupported image does not prevent semantic orb derivation.
    }
  }
  return { seed: stableSeed(vibeUuid), image_palette: aggregateImagePalettes(palettes) };
}

function isStop(value: unknown): value is MeasuredColor {
  if (!value || typeof value !== "object") return false;
  const stop = value as Record<string, unknown>;
  return typeof stop.color === "string" && typeof stop.weight === "number";
}

/** Guarantee a stable seed and an explicit measured contribution while retaining semantic colors. */
export function transformVibeOrbOutput(output: TaskOutput, context: VibeContext): TaskOutput {
  const taskContext = context.task_context ?? {};
  const seed = typeof taskContext.seed === "string" ? taskContext.seed : output.seed;
  const measured = Array.isArray(taskContext.image_palette)
    ? taskContext.image_palette.filter(isStop)
    : [];
  const semantic = Array.isArray(output.palette) ? output.palette.filter(isStop) : [];
  const combined: MeasuredColor[] = [];
  const add = (stop: MeasuredColor, weightScale: number) => {
    const color = stop.color.toLowerCase() as `#${string}`;
    if (combined.length < 6) combined.push({ color, weight: stop.weight * weightScale });
  };
  for (const stop of measured.slice(0, 2)) add(stop, 0.42);
  for (const stop of semantic) add(stop, measured.length ? 0.58 : 1);
  for (const stop of measured.slice(2)) add(stop, 0.42);
  const total = combined.reduce((sum, stop) => sum + stop.weight, 0) || 1;
  return {
    ...output,
    seed,
    palette: combined.map((stop) => ({
      color: stop.color,
      weight: Number((stop.weight / total).toFixed(4)),
    })),
  };
}
