import { expect, test, type Page } from "@playwright/test";
import { ORB_PRESETS } from "../src/orb/recipe.ts";
import { installMockStore, NEW_VIBE_ID, VIBE_ID } from "./support/mockStore.ts";

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

test("a cached image survives reload without WebGL, while recipe changes replace it", async ({
  page,
}) => {
  const store = await installMockStore(page);
  store.vibes[0]!.inferred = inferred();
  await probeContexts(page);
  await page.goto("/vibes");
  const row = page.getByRole("button", { name: "Open Vibe Spending" });
  const orb = row.locator("[data-vibe-orb-renderer]");
  await expect(orb).toHaveAttribute("data-vibe-orb-renderer", "raster");
  const original = await orb.locator("img").screenshot();
  const originalSrc = await orb.locator("img").getAttribute("src");

  // Use the normal query refetch path to update a mounted row, including a recipe with the same seed.
  store.vibes[0]!.inferred = inferred({ ...ORB_PRESETS.ember, seed: ORB_PRESETS.bloom.seed });
  await page.evaluate(() => {
    for (const visibilityState of ["hidden", "visible"]) {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: visibilityState,
      });
      window.dispatchEvent(new Event("visibilitychange"));
    }
    Reflect.deleteProperty(document, "visibilityState");
  });
  await expect(orb.locator("img")).not.toHaveAttribute("src", originalSrc!);
  await expect(orb).toHaveAttribute("data-vibe-orb-renderer", "raster");
  const updated = await orb.locator("img").screenshot();
  expect(updated).not.toEqual(original);

  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value(context: string, ...args: unknown[]) {
        if (context === "webgl2") throw new Error("Cache hit must not create a WebGL context");
        return Reflect.apply(original, this, [context, ...args]);
      },
    });
  });
  await page.reload();
  await expect(orb).toHaveAttribute("data-vibe-orb-renderer", "raster");
  expect(await orb.locator("img").screenshot()).toEqual(updated);
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { __orbProbe: { contexts: number } }).__orbProbe.contexts,
    ),
  ).toBe(0);
});

test("switching between warmed Vibes shows their raster immediately without a fallback flash", async ({
  page,
}) => {
  const store = await installMockStore(page);
  store.vibes[0]!.inferred = inferred();
  store.vibes.push({
    ...structuredClone(store.vibes[0]!),
    uri: `rnet://vibe/${NEW_VIBE_ID}`,
    title: "Library",
    inferred: inferred(ORB_PRESETS.ember),
  });
  await page.goto("/vibes");
  for (const title of ["Spending", "Library"]) {
    await expect(
      page
        .getByRole("button", { name: `Open Vibe ${title}`, exact: true })
        .locator("[data-vibe-orb-renderer]"),
    ).toHaveAttribute("data-vibe-orb-renderer", "raster");
  }
  const dock = page.locator("[data-shell-dock]");
  await dock.evaluate((element) => {
    const states: (string | null)[] = [];
    const observer = new MutationObserver(() => {
      for (const orb of element.querySelectorAll('[data-vibe-orb-motion="still"]')) {
        states.push(orb.getAttribute("data-vibe-orb-renderer"));
      }
    });
    observer.observe(element, { attributes: true, childList: true, subtree: true });
    Object.assign(window, { __warmOrbProbe: { states, stop: () => observer.disconnect() } });
  });
  await page.getByRole("button", { name: "Open Vibe Spending", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/vibes/${VIBE_ID}\\?`));
  await page
    .getByRole("region", { name: "Pinned apps", exact: true })
    .getByRole("button", { name: "Vibes", exact: true })
    .click();
  await page.getByRole("button", { name: "Open Vibe Library", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/vibes/${NEW_VIBE_ID}\\?`));
  const recent = page.getByRole("region", { name: "Recent windows", exact: true });
  for (const title of ["Spending", "Library", "Spending"]) {
    await recent.getByRole("button", { name: title, exact: true }).click();
    await expect(
      page.locator("[data-dock-app-slot]").getByRole("button", { name: title, exact: true }),
    ).toBeVisible();
  }
  const states = await page.evaluate(() => {
    const probe = (
      window as typeof window & {
        __warmOrbProbe: { states: (string | null)[]; stop: () => void };
      }
    ).__warmOrbProbe;
    probe.stop();
    return probe.states;
  });
  expect(states.length).toBeGreaterThan(0);
  expect([...new Set(states)]).toEqual(["raster"]);
});

test("a long list rasterizes visible orbs through a single shared context", async ({ page }) => {
  const store = await installMockStore(page);
  const source = store.vibes[0]!;
  store.vibes.splice(
    0,
    store.vibes.length,
    ...Array.from({ length: 80 }, (_, index) => ({
      ...source,
      uri: `rnet://vibe/0198f2a1-b19c-77bb-a6e9-${String(index + 100).padStart(12, "0")}`,
      title: `Raster ${index}`,
      inferred: inferred({ ...ORB_PRESETS.tideglass, seed: `raster-${index}` }),
    })),
  );
  await probeContexts(page);
  await page.goto("/vibes");
  const images = page.locator('[data-vibe-orb-renderer="raster"] img');
  await expect(images.first()).toBeVisible();
  expect(await images.count()).toBeLessThan(80);
  const last = page.getByRole("button", { name: "Open Vibe Raster 79", exact: true });
  await last.scrollIntoViewIfNeeded();
  await expect(last.locator('[data-vibe-orb-renderer="raster"] img')).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { __orbProbe: { contexts: number } }).__orbProbe.contexts,
    ),
  ).toBe(1);
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("blocked storage still renders images and missing WebGL retains the CSS identity", async ({
  page,
}) => {
  const store = await installMockStore(page);
  store.vibes[0]!.inferred = inferred();
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      get() {
        throw new Error("Storage blocked");
      },
    });
  });
  await page.goto("/vibes");
  const orb = page
    .getByRole("button", { name: "Open Vibe Spending" })
    .locator("[data-vibe-orb-renderer]");
  await expect(orb).toHaveAttribute("data-vibe-orb-renderer", "raster");
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value(context: string, ...args: unknown[]) {
        return context === "webgl2" ? null : Reflect.apply(original, this, [context, ...args]);
      },
    });
  });
  await page.reload();
  await expect(orb).toHaveAttribute("data-vibe-orb-renderer", "fallback");
  await expect(orb.locator("span[aria-hidden]")).toHaveCSS("opacity", "1");
  await expect(orb.locator("img, canvas")).toHaveCount(0);
});

test("decoded raster sources share the bounded cache and remain usable after eviction", async ({
  page,
}) => {
  await installMockStore(page);
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/src/orb/raster.ts";
    const recipePath = "/src/orb/recipe.ts";
    const { getOrbRaster, getOrbRasterSource, cachedOrbRasterSource, orbRasterKey } = await import(
      path
    );
    const { ORB_PRESETS } = await import(recipePath);
    const entries: { key: string; bytes: number }[] = [];
    let retainedSource = "";
    for (let i = 0; i < 65; i++) {
      const recipe = { ...ORB_PRESETS.bloom, seed: `bounded-${i}` };
      const blob = await getOrbRaster(recipe);
      const source = await getOrbRasterSource(recipe);
      if (i === 0) retainedSource = source;
      entries.push({ key: orbRasterKey(recipe), bytes: blob.size + source.length * 2 });
    }
    const cached = entries.filter(({ key }) => cachedOrbRasterSource(key) !== undefined);
    // Mounted consumers can keep their source independently of its eviction from the cache.
    const image = new Image();
    image.src = retainedSource;
    await image.decode();
    return {
      entries: cached.length,
      bytes: cached.reduce((sum, entry) => sum + entry.bytes, 0),
      oldestEvicted: cachedOrbRasterSource(entries[0]!.key) === undefined,
      newestRetained: cachedOrbRasterSource(entries.at(-1)!.key) !== undefined,
      retainedWidth: image.naturalWidth,
    };
  });
  expect(result.entries).toBeLessThanOrEqual(64);
  expect(result.bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(result.oldestEvicted).toBe(true);
  expect(result.newestRetained).toBe(true);
  expect(result.retainedWidth).toBe(256);
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
