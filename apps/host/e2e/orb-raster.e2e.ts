import { expect, test, type Page } from "@playwright/test";
import { ORB_PRESETS } from "../src/orb/recipe.ts";
import { installMockStore } from "./support/mockStore.ts";

const inferred = (properties = ORB_PRESETS.bloom) => ({
  "rhizome:vibe-orb": { model: "test", confidence: 1, properties: { ...properties } },
});

async function probeContexts(page: Page) {
  await page.addInitScript(() => {
    const probe = { contexts: 0 };
    Object.defineProperty(window, "__orbProbe", { value: probe });
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value(context: string, ...args: unknown[]) {
        if (context === "webgl2") {
          probe.contexts += 1;
        }
        return Reflect.apply(original, this, [context, ...args]);
      },
      configurable: true,
    });
  });
}

test("PNG captures match the live still shader and retain transparent edges", async ({ page }) => {
  await installMockStore(page);
  await page.goto("/");
  const captures = await page.evaluate(async () => {
    const rendererPath = "/src/orb/renderer.ts";
    const recipePath = "/src/orb/recipe.ts";
    const rasterPath = "/src/orb/raster.ts";
    const { OrbRenderer } = await import(rendererPath);
    const { ORB_PRESETS } = await import(recipePath);
    const { getOrbRaster, ORB_RASTER_SIZE } = await import(rasterPath);
    const results = [];
    for (const recipe of Object.values(ORB_PRESETS)) {
      const pending = getOrbRaster(recipe);
      const deduplicated = pending === getOrbRaster(recipe);
      const blob: Blob = await pending;
      const live = document.createElement("canvas");
      const dimension = ORB_RASTER_SIZE / Math.min(devicePixelRatio || 1, 2);
      live.style.width = `${dimension}px`;
      live.style.height = `${dimension}px`;
      document.body.append(live);
      const renderer = new OrbRenderer(live, recipe, { motion: "still" });
      await new Promise(requestAnimationFrame);
      const reference = await new Promise<Blob>((resolve) => live.toBlob((blob) => resolve(blob!)));
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      results.push({
        deduplicated,
        matches:
          String(new Uint8Array(await blob.arrayBuffer())) ===
          String(new Uint8Array(await reference.arrayBuffer())),
        type: blob.type,
        size: bitmap.width,
        cornerAlpha: context.getImageData(0, 0, 1, 1).data[3],
        centerAlpha: context.getImageData(128, 128, 1, 1).data[3],
      });
      bitmap.close();
      renderer.destroy();
      live.remove();
    }
    return results;
  });
  expect(captures).toHaveLength(4);
  for (const capture of captures) {
    expect(capture).toEqual({
      deduplicated: true,
      matches: true,
      type: "image/png",
      size: 256,
      cornerAlpha: 0,
      centerAlpha: 255,
    });
  }
});

test("disk cache evicts old entries by recency and encoded size", async ({ page }) => {
  await installMockStore(page);
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/src/orb/rasterCache.ts";
    const { writeOrbRaster, readOrbRaster } = await import(path);
    const tiny = new Blob(["test"], { type: "image/png" });
    for (let i = 0; i < 128; i++) await writeOrbRaster(`entry-${i}`, tiny);
    await readOrbRaster("entry-0");
    await writeOrbRaster("new", tiny);
    const recentSurvived = Boolean(await readOrbRaster("entry-0"));
    const oldEvicted = (await readOrbRaster("entry-1")) === null;
    const large = new Blob([new Uint8Array(9 * 1024 * 1024)], { type: "image/png" });
    await writeOrbRaster("large-old", large);
    await writeOrbRaster("large-new", large);
    return {
      recentSurvived,
      oldEvicted,
      largeOldEvicted: (await readOrbRaster("large-old")) === null,
      largeNewSurvived: Boolean(await readOrbRaster("large-new")),
    };
  });
  expect(result).toEqual({
    recentSurvived: true,
    oldEvicted: true,
    largeOldEvicted: true,
    largeNewSurvived: true,
  });
});
