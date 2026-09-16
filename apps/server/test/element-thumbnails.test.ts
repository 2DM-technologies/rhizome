import { describe, expect, test } from "bun:test";
import sharp from "sharp";

import { contentHash } from "../src/blobs/content.ts";
import { ElementThumbnailCache } from "../src/blobs/element-thumbnails.ts";
import type { BlobStore, StoredBlob } from "../src/blobs/types.ts";
import type { BlobNamespace } from "../src/config.ts";

class MemoryBlobs implements BlobStore {
  readonly records = new Map<string, StoredBlob>();
  readonly reads: string[] = [];
  readonly writes: string[] = [];
  failNextWrite = false;

  async get(namespace: BlobNamespace, key: string) {
    this.reads.push(`${namespace}/${key}`);
    return this.records.get(`${namespace}/${key}`) ?? null;
  }

  async put(namespace: BlobNamespace, key: string, bytes: Uint8Array, contentType?: string) {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error("Temporary storage failure");
    }
    this.writes.push(`${namespace}/${key}`);
    this.records.set(`${namespace}/${key}`, { bytes, contentType });
  }

  async delete(namespace: BlobNamespace, key: string) {
    this.records.delete(`${namespace}/${key}`);
  }

  async signedUrl(): Promise<string> {
    throw new Error("Thumbnails must be served through the authorized endpoint");
  }
}

async function fixture() {
  const original = await sharp({
    create: { width: 800, height: 400, channels: 3, background: "#7d59ff" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const element = {
    contentHash: await contentHash(original),
    mime: "image/jpeg",
    byteSize: original.byteLength,
  };
  const blobs = new MemoryBlobs();
  blobs.records.set(`elements/${element.contentHash}`, {
    bytes: original,
    contentType: element.mime,
  });
  return { blobs, element, original, cache: new ElementThumbnailCache(blobs) };
}

describe("element thumbnail cache", () => {
  test("persists a small WebP and reuses it after the cache instance is recreated", async () => {
    const { blobs, cache, element, original } = await fixture();
    const first = await cache.get(element);
    expect(first).not.toBeNull();
    const metadata = await sharp(first!.bytes).metadata();
    expect(metadata).toMatchObject({ format: "webp", width: 64, height: 64 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
    expect(first!.bytes.byteLength).toBeLessThan(original.byteLength);
    expect(first!.contentType).toBe("image/webp");
    expect(blobs.writes).toEqual([`elements/thumbnails/v1/64/${element.contentHash}.webp`]);

    const second = await new ElementThumbnailCache(blobs).get(element);
    expect(second!.bytes).toEqual(first!.bytes);
    expect(blobs.reads.filter((key) => key === `elements/${element.contentHash}`)).toHaveLength(1);
    expect(blobs.writes).toHaveLength(1);
    expect(blobs.records.get(`elements/${element.contentHash}`)!.bytes).toEqual(original);
  });

  test("concurrent requests share one source read and one thumbnail write", async () => {
    const { blobs, cache, element } = await fixture();
    const results = await Promise.all(Array.from({ length: 12 }, () => cache.get(element)));
    expect(results.every((result) => result?.bytes === results[0]?.bytes)).toBe(true);
    expect(blobs.reads.filter((key) => key === `elements/${element.contentHash}`)).toHaveLength(1);
    expect(blobs.writes).toHaveLength(1);
  });

  test("clears in-flight failures so a storage retry can succeed", async () => {
    const { blobs, cache, element } = await fixture();
    blobs.failNextWrite = true;
    await expect(cache.get(element)).rejects.toThrow("Temporary storage failure");
    expect(await cache.get(element)).not.toBeNull();
    expect(blobs.writes).toHaveLength(1);
  });

  test("a burst of distinct images downloads and decodes at most two originals at once", async () => {
    const { blobs, cache, element, original } = await fixture();
    const held: Array<() => void> = [];
    let started = 0;
    let firstWaveStarted!: () => void;
    const firstWave = new Promise<void>((resolve) => {
      firstWaveStarted = resolve;
    });
    const get = blobs.get.bind(blobs);
    blobs.get = async (namespace, key) => {
      if (!key.startsWith("thumbnails/")) {
        started++;
        if (started === 2) firstWaveStarted();
        await new Promise<void>((resolve) => held.push(resolve));
      }
      return get(namespace, key);
    };
    const tasks = Array.from({ length: 5 }, (_, index) => {
      const hash = `sha256:${String(index).repeat(64)}`;
      blobs.records.set(`elements/${hash}`, { bytes: original });
      return cache.get({ ...element, contentHash: hash });
    });
    await firstWave;
    expect(started).toBe(2);
    held.shift()!();
    await tasks[0];
    expect(started).toBe(3);
    held.shift()!();
    await tasks[1];
    expect(started).toBe(4);
    held.shift()!();
    await tasks[2];
    expect(started).toBe(5);
    for (const release of held) release();
    expect((await Promise.all(tasks)).every(Boolean)).toBe(true);
  });

  test("unsupported media and oversized metadata never load the original", async () => {
    const { blobs, cache, element } = await fixture();
    for (const mime of ["video/mp4", "text/plain", "image/svg+xml", "application/pdf"]) {
      expect(await cache.get({ ...element, mime })).toBeNull();
    }
    expect(await cache.get({ ...element, byteSize: 50 * 1024 * 1024 + 1 })).toBeNull();
    expect(blobs.reads).toHaveLength(0);
    expect(blobs.writes).toHaveLength(0);
  });

  test("missing and corrupt payloads are not cached, and a later valid request can succeed", async () => {
    const { blobs, cache, element, original } = await fixture();
    blobs.records.delete(`elements/${element.contentHash}`);
    expect(await cache.get(element)).toBeNull();
    blobs.records.set(`elements/${element.contentHash}`, {
      bytes: new TextEncoder().encode("bad"),
    });
    expect(await cache.get(element)).toBeNull();
    expect(blobs.writes).toHaveLength(0);
    blobs.records.set(`elements/${element.contentHash}`, { bytes: original });
    expect(await cache.get(element)).not.toBeNull();
  });

  test("different source content gets its own cache entry", async () => {
    const { blobs, cache, element } = await fixture();
    const bytes = await sharp({
      create: { width: 160, height: 160, channels: 3, background: "#ff2200" },
    })
      .png()
      .toBuffer();
    const next = {
      contentHash: await contentHash(bytes),
      mime: "image/png",
      byteSize: bytes.length,
    };
    blobs.records.set(`elements/${next.contentHash}`, { bytes });
    const first = await cache.get(element);
    const second = await cache.get(next);
    expect(second!.bytes).not.toEqual(first!.bytes);
    expect(blobs.writes).toHaveLength(2);
  });
});
