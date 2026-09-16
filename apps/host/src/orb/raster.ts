import { normalizeOrbRecipe, type OrbVisualRecipe } from "./recipe.ts";
import { OrbRasterizer, ORB_SHADER_SOURCE } from "./renderer.ts";
import { readOrbRaster, writeOrbRaster } from "./rasterCache.ts";

export const ORB_RASTER_SIZE = 256;
// Bump when capture/CPU rendering behavior changes. Shader and material changes are hashed below.
const RASTER_VERSION = 1;
const MEMORY_ENTRIES = 64;
const MEMORY_BYTES = 8 * 1024 * 1024;
interface CachedRaster {
  blob: Blob;
  source?: string;
}

const memory = new Map<string, CachedRaster>();
const pending = new Map<string, Promise<Blob>>();
const pendingSources = new Map<string, Promise<string>>();
let memoryBytes = 0;
let renderer: OrbRasterizer | undefined;
let queue: Promise<unknown> = Promise.resolve();
let idleTimer: ReturnType<typeof setTimeout> | undefined;

export function orbRasterKey(recipe: OrbVisualRecipe): string {
  return JSON.stringify([RASTER_VERSION, ORB_RASTER_SIZE, normalizeOrbRecipe(recipe)]);
}

async function storageKey(key: string): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify([ORB_SHADER_SOURCE, key])),
    );
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(
      "",
    );
  } catch {
    return null;
  }
}

function disposeRenderer() {
  clearTimeout(idleTimer);
  renderer?.destroy();
  renderer = undefined;
}

function render(recipe: OrbVisualRecipe): Promise<Blob> {
  const job = queue.then(async () => {
    // Give scrolling and input a turn between captures; never create a context per list item.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    clearTimeout(idleTimer);
    try {
      renderer ??= new OrbRasterizer();
      return await renderer.render(recipe, ORB_RASTER_SIZE);
    } catch (error) {
      disposeRenderer();
      throw error;
    } finally {
      idleTimer = setTimeout(disposeRenderer, 30_000);
    }
  });
  queue = job.catch(() => {});
  return job;
}

function remember(key: string, blob: Blob) {
  memory.set(key, { blob });
  memoryBytes += blob.size;
  trimMemory();
}

function trimMemory() {
  while (memory.size > MEMORY_ENTRIES || memoryBytes > MEMORY_BYTES) {
    const oldest = memory.entries().next().value;
    if (!oldest) break;
    memory.delete(oldest[0]);
    memoryBytes -= oldest[1].blob.size + (oldest[1].source?.length ?? 0) * 2;
  }
}

/** All consumers of the same appearance share one lookup/capture, including concurrent mounts. */
export function getOrbRaster(input: OrbVisualRecipe): Promise<Blob> {
  const recipe = normalizeOrbRecipe(input);
  const key = orbRasterKey(recipe);
  const cached = memory.get(key);
  if (cached) {
    memory.delete(key);
    memory.set(key, cached);
    return Promise.resolve(cached.blob);
  }
  const existing = pending.get(key);
  if (existing) return existing;
  const job = (async () => {
    const persistentKey = await storageKey(key);
    const stored = persistentKey ? await readOrbRaster(persistentKey) : null;
    const blob = stored ?? (await render(recipe));
    if (!stored && persistentKey) await writeOrbRaster(persistentKey, blob);
    remember(key, blob);
    return blob;
  })().finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

/** A decoded, reusable source can render on the first commit when a cached orb changes slots. */
export function cachedOrbRasterSource(key: string): string | undefined {
  return memory.get(key)?.source;
}

export function getOrbRasterSource(recipe: OrbVisualRecipe): Promise<string> {
  const key = orbRasterKey(recipe);
  const existing = pendingSources.get(key);
  if (existing) return existing;
  const job = getOrbRaster(recipe)
    .then(async (blob) => {
      const cached = memory.get(key)?.source;
      if (cached) return cached;
      const source = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      const image = new Image();
      image.src = source;
      await image.decode();
      const entry = memory.get(key);
      if (entry?.blob === blob) {
        entry.source = source;
        // Account for the reusable string as well as the Blob in the existing cache budget.
        memoryBytes += source.length * 2;
        trimMemory();
      }
      return source;
    })
    .finally(() => pendingSources.delete(key));
  pendingSources.set(key, job);
  return job;
}

if (typeof window !== "undefined") window.addEventListener("pagehide", disposeRenderer);
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.removeEventListener("pagehide", disposeRenderer);
    disposeRenderer();
  });
}
