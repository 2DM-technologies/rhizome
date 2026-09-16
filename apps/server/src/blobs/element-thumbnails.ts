import sharp from "sharp";

import type { DbMediaElement } from "../db/models/media-element.ts";
import type { BlobStore, StoredBlob } from "./types.ts";

const SIZE = 64;
const MAX_INPUT_BYTES = 50 * 1024 * 1024;
const MAX_INPUT_PIXELS = 64_000_000;
const IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/tiff",
]);
const IMAGE_FORMATS = new Set(["jpeg", "png", "webp", "gif", "heif", "tiff"]);

type ThumbnailElement = Pick<DbMediaElement, "contentHash" | "mime" | "byteSize">;

/** Derived bytes only: callers must authorize the element before every lookup, including hits. */
export class ElementThumbnailCache {
  private readonly pending = new Map<string, Promise<StoredBlob | null>>();
  private activeGenerations = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly blobs: BlobStore) {}

  async get(element: ThumbnailElement): Promise<StoredBlob | null> {
    const mime = element.mime.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (!IMAGE_MIMES.has(mime) || element.byteSize > MAX_INPUT_BYTES) return null;
    // Bump the profile version when changing dimensions, crop, format, or encoder settings.
    const key = `thumbnails/v1/${SIZE}/${element.contentHash}.webp`;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const loading = this.load(key, element.contentHash);
    this.pending.set(key, loading);
    try {
      return await loading;
    } finally {
      this.pending.delete(key);
    }
  }

  private async load(key: string, contentHash: string): Promise<StoredBlob | null> {
    const cached = await this.blobs.get("elements", key);
    if (cached) return cached;
    // A newly opened desktop can request many different images. Keep original downloads and
    // decodes bounded; queued requests retain only their keys, not full-size image buffers.
    if (this.activeGenerations < 2) this.activeGenerations++;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    try {
      return await this.generate(key, contentHash);
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.activeGenerations--;
    }
  }

  private async generate(key: string, contentHash: string): Promise<StoredBlob | null> {
    const original = await this.blobs.get("elements", contentHash);
    if (!original || original.bytes.byteLength > MAX_INPUT_BYTES) return null;

    let bytes: Uint8Array;
    try {
      // First frame only; auto-orient before cropping and strip original metadata on output.
      const image = sharp(original.bytes, {
        limitInputPixels: MAX_INPUT_PIXELS,
        failOn: "warning",
        animated: false,
      });
      const metadata = await image.metadata();
      if (!metadata.format || !IMAGE_FORMATS.has(metadata.format)) return null;
      bytes = await image
        .autoOrient()
        .resize(SIZE, SIZE, { fit: "cover" })
        .webp({ quality: 75 })
        .timeout({ seconds: 10 })
        .toBuffer();
    } catch {
      // Unsupported, corrupt, or oversized images keep the host's lightweight placeholder.
      return null;
    }
    await this.blobs.put("elements", key, bytes, "image/webp");
    return { bytes, contentType: "image/webp" };
  }
}
