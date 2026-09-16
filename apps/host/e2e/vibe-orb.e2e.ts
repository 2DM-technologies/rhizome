import { expect, test } from "@playwright/test";
import { storeTaskKey } from "@rhizome/store-contract";

import { PUSH_TASKS } from "../src/api/generated/push-tasks.ts";
import { ORB_PRESETS } from "../src/orb/recipe.ts";
import { installMockStore, VIBE_ID } from "./support/mockStore.ts";

const PLAYGROUND = "/playgrounds/vibe-orb";

test("opening from the dock preserves full-resolution orb geometry through the window scale", async ({
  page,
}) => {
  const store = await installMockStore(page);
  store.vibes[0]!.inferred = {
    "rhizome:vibe-orb": { model: "test", confidence: 1, properties: { ...ORB_PRESETS.bloom } },
  };
  // Hold the real dock transition at its starting scale so the initial size check is deterministic.
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = Reflect.apply(animate, this, args) as Animation;
      if (this.hasAttribute("data-surface-opening")) {
        animation.pause();
        animation.currentTime = 0;
      }
      return animation;
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open Vibe Spending" }).click();
  await page.getByRole("button", { name: "Close surface", exact: true }).click();
  await page.getByRole("button", { name: "Spending", exact: true }).click();

  const hero = page.getByLabel("Spending Vibe orb");
  const canvas = hero.locator("canvas");
  await expect(hero).toHaveAttribute("data-vibe-orb-renderer", "webgl");
  const expectedSize = await page.evaluate(() =>
    Math.round(72 * Math.min(devicePixelRatio || 1, 2)),
  );
  await expect(page.locator("[data-surface-opening]")).toHaveCount(1);
  expect(await canvas.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThan(
    72,
  );
  await expect(canvas).toHaveAttribute("width", String(expectedSize));
  await expect(canvas).toHaveAttribute("height", String(expectedSize));

  await page.locator("[data-surface-opening]").evaluate((element) => {
    element.getAnimations().forEach((animation) => animation.finish());
  });
  await expect(page.locator("[data-surface-opening]")).toHaveCount(0);
  await expect(canvas).toHaveCSS("width", "72px");
  await expect(canvas).toHaveCSS("height", "72px");
  await expect(canvas).toHaveAttribute("width", String(expectedSize));
  await expect(canvas).toHaveAttribute("height", String(expectedSize));

  // A genuine layout resize still updates the drawing buffer.
  await hero.evaluate((element) => {
    element.style.width = "96px";
    element.style.height = "96px";
  });
  const resized = await page.evaluate(() => Math.round(96 * Math.min(devicePixelRatio || 1, 2)));
  await expect(canvas).toHaveAttribute("width", String(resized));
  await expect(canvas).toHaveAttribute("height", String(resized));
});

test("independent glass controls and object composition render across their ranges", async ({
  page,
}, testInfo) => {
  await page.goto(PLAYGROUND);
  await expect(page.locator('[data-vibe-orb-renderer="webgl"]')).toHaveCount(9);
  await expect(
    page.getByRole("group", { name: "Surface", exact: true }).getByRole("slider"),
  ).toHaveCount(2);
  await expect(
    page.getByRole("group", { name: "Motion", exact: true }).getByRole("slider"),
  ).toHaveCount(3);
  const preview = page.getByLabel("Large procedural Vibe orb preview");
  const canvas = preview.locator("canvas");
  await page.getByRole("button", { name: "still", exact: true }).click();
  for (const name of [
    "Pattern scale",
    "Warp",
    "Ribbons",
    "Depth",
    "Glow",
    "Drift",
    "Turbulence",
    "Spin",
  ]) {
    const slider = page.getByRole("slider", { name, exact: true });
    await slider.focus();
    await slider.press("End");
    await expect(slider).toHaveValue("1");
    await expect(preview).toHaveAttribute("data-vibe-orb-renderer", "webgl");
    await slider.press("Home");
    await expect(slider).toHaveValue("0");
  }
  for (const name of ["Bloom", "Ember", "Tideglass", "Lichen"]) {
    await page.locator("aside").getByRole("button", { name, exact: true }).click();
    await expect(canvas).toHaveAttribute("data-vibe-orb-animating", "false");
    await page.waitForTimeout(1000);
    await preview.screenshot({ path: testInfo.outputPath(`${name.toLowerCase()}.png`) });
  }
  // A still canvas must update immediately, and returning to a recipe must reproduce its pixels.
  await page.locator("aside").getByRole("button", { name: "Bloom", exact: true }).click();
  const bloomPixels = await canvas.screenshot();
  await page.locator("aside").getByRole("button", { name: "Ember", exact: true }).click();
  expect(await canvas.screenshot()).not.toEqual(bloomPixels);
  await page.locator("aside").getByRole("button", { name: "Bloom", exact: true }).click();
  expect(await canvas.screenshot()).toEqual(bloomPixels);
  const count = page.getByRole("slider", { name: "Tideglass objects" });
  await count.focus();
  await count.press("End");
  await expect(count).toHaveValue("10");
  await expect(page.getByRole("slider", { name: "Drift", exact: true })).not.toHaveValue("0.08");
  await expect(preview).toHaveAttribute("data-vibe-orb-renderer", "webgl");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: testInfo.outputPath("object-composition.png"), fullPage: true });
});

test("the playground renders one shader across hero and actual icon sizes", async ({ page }) => {
  await page.goto(PLAYGROUND);
  const orbs = page.locator("[data-vibe-orb-renderer]");
  await expect(orbs).toHaveCount(9);
  await expect(page.locator('[data-vibe-orb-renderer="webgl"]')).toHaveCount(9);

  const largeCanvas = page.getByLabel("Large procedural Vibe orb preview").locator("canvas");
  await expect(largeCanvas).toHaveAttribute("data-vibe-orb-animating", "true");
  const stillCanvases = page.locator('[data-vibe-orb-motion="still"] canvas');
  await expect(stillCanvases).toHaveCount(4);
  await expect(stillCanvases.first()).toHaveAttribute("data-vibe-orb-animating", "false");

  await page.locator("aside").getByRole("button", { name: "Ember", exact: true }).click();
  await expect(page.getByLabel("Deterministic seed")).toHaveValue(
    "0198f2a1-ember-7c92-a034-5d7e2f9a0c13",
  );
  await expect(page.getByLabel("Contrast")).toHaveValue("0.9");
});

test("interaction-only list marks wake for keyboard focus and go still again", async ({ page }) => {
  await page.goto(PLAYGROUND);
  const list = page.getByRole("button", { name: "List · 20", exact: true });
  const canvas = list.locator("canvas");
  await expect(list.locator('[data-vibe-orb-renderer="webgl"]')).toHaveCount(1);

  await page.waitForTimeout(1_100);
  await expect(canvas).toHaveAttribute("data-vibe-orb-animating", "false");

  await page.mouse.move(0, 0);
  await list.focus();
  await expect(canvas).toHaveAttribute("data-vibe-orb-animating", "true");

  await page.mouse.move(0, 0);
  await list.blur();
  await expect(list).not.toBeFocused();
  await expect(canvas).toHaveAttribute("data-vibe-orb-animating", "false", { timeout: 3_000 });
});

test("reduced motion freezes every orb", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PLAYGROUND);
  await expect(page.locator('[data-vibe-orb-motion="reduced"]')).toHaveCount(9);

  const largeCanvas = page.getByLabel("Large procedural Vibe orb preview").locator("canvas");
  await expect(largeCanvas).toHaveAttribute("data-vibe-orb-animating", "false");
  const before = await largeCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.waitForTimeout(180);
  const after = await largeCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  expect(after).toBe(before);
});

test("a missing WebGL2 context keeps the palette-derived still visible", async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value(contextId: string, ...args: unknown[]) {
        if (contextId === "webgl2") return null;
        return Reflect.apply(getContext, this, [contextId, ...args]);
      },
    });
  });
  await page.goto(PLAYGROUND);
  await expect(page.locator('[data-vibe-orb-renderer="fallback"]')).toHaveCount(9);
  const large = page.getByLabel("Large procedural Vibe orb preview");
  await expect(large.locator("canvas")).toHaveCount(0);
  await expect(large.locator("span[aria-hidden]").first()).toHaveCSS("opacity", "1");
});

test("the neutral pre-inference orb pulses as a reduced-motion-safe loading state", async ({
  page,
}) => {
  await installMockStore(page);
  await page.goto("/");

  const card = page.locator("[data-desktop-vibe-card]").filter({ hasText: "Spending" });
  const overlay = card.locator("[data-vibe-orb-loading-overlay]");
  await expect(card).toHaveAttribute("data-vibe-card-background", "fallback");
  await expect(overlay).toHaveCount(1);
  await expect(overlay).toHaveCSS("animation-name", "vibe-orb-loading-pulse");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(overlay).toHaveCSS("animation-name", "none");
  await expect(overlay).toHaveCSS("opacity", "0.14");
});

test("persisted recipes use images for small orbs, animate desktop hover, and keep the hero live", async ({
  page,
}) => {
  const store = await installMockStore(page);
  const vibe = store.vibes[0]!;
  const original = store.objects.values().next().value!;
  vibe.objects = Array.from({ length: 9 }, (_, index) => {
    const uuid = `0198f2a1-b19c-77bb-a6e9-${String(index + 100).padStart(12, "0")}`;
    store.objects.set(uuid, { ...original, uri: `rnet://object/${uuid}` });
    return `rnet://object/${uuid}`;
  });
  vibe.inferred = {
    ...vibe.inferred,
    [storeTaskKey(PUSH_TASKS.vibe["vibe-orb"].name)]: {
      model: "mock/rhizome",
      inferred_at: "2026-09-13T12:00:00.000Z",
      properties: {
        version: 3,
        seed: "0123456789abcdef0123456789abcdef",
        palette: [
          { color: "#174c66", weight: 0.35 },
          { color: "#33a1a8", weight: 0.4 },
          { color: "#f4c95d", weight: 0.25 },
        ],
        contrast: 0.45,
        field: {
          grain: 0.25,
          warp: 0.62,
          anisotropy: 0.3,
        },
        surface: { depth: 0.6, glow: 0.5 },
        motion: { drift: 0.5, turbulence: 0.3, spin: 0.2 },
      },
    },
  };

  await page.goto("/");
  const card = page.locator("[data-desktop-vibe-card]").filter({ hasText: "Spending" });
  const cardOrb = card.locator('[data-vibe-orb-motion="still"]');
  await expect(card).toHaveAttribute("data-vibe-card-background", "inferred");
  await expect(card).toHaveAttribute("style", /#33a1a8/);
  await expect(card).toHaveCSS("background-image", "none");
  await expect(card).not.toHaveClass(/translate-y/);
  await expect(card.locator(":scope > div").first()).toHaveCSS("padding-top", "9px");
  await expect(card.locator("[data-object-thumbnail]").first()).toHaveCSS("width", "20px");
  await expect(card.locator("[data-object-thumbnail]").first()).toHaveCSS("height", "20px");
  await expect(card.locator("[data-object-thumbnail]")).toHaveCount(6);
  await expect(card.getByText("+3", { exact: true })).toBeVisible();
  await expect(cardOrb).toHaveCount(1);
  await expect(card.locator("[data-vibe-orb-loading-overlay]")).toHaveCount(0);
  await expect(card.locator('img[src*="orb-user-24"]')).toHaveCount(0);
  await expect(cardOrb).toHaveAttribute("data-vibe-orb-renderer", "raster");
  await expect(cardOrb.locator("img")).toBeVisible();
  const cardIdentityOrder = await card.evaluate((element) => {
    const orb = element.querySelector("[data-vibe-orb-renderer]")!.getBoundingClientRect();
    const title = element.querySelector("h3")!.getBoundingClientRect();
    return orb.left < title.left;
  });
  expect(cardIdentityOrder).toBe(true);
  await expect(card.locator("canvas")).toHaveCount(0);
  const rasterBounds = await cardOrb.locator("img").boundingBox();
  expect(rasterBounds).not.toBeNull();
  await card.hover();
  await expect(card.locator("canvas")).toHaveAttribute("data-vibe-orb-animating", "true");
  await expect(cardOrb).toHaveCSS("visibility", "hidden");
  expect(await card.locator("canvas").boundingBox()).toEqual(rasterBounds);
  await page.mouse.move(0, 0);
  await expect(card.locator("canvas")).toHaveCount(0);
  await expect(cardOrb).toHaveCSS("visibility", "visible");
  expect(await cardOrb.locator("img").boundingBox()).toEqual(rasterBounds);
  const open = card.getByRole("button", { name: "Open Vibe Spending" });
  await open.focus();
  await expect(card.locator("canvas")).toHaveAttribute("data-vibe-orb-animating", "true");
  expect(await card.locator("canvas").boundingBox()).toEqual(rasterBounds);
  await open.blur();
  await expect(card.locator("canvas")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await card.hover();
  await expect(card.locator("canvas")).toHaveCount(0);
  await expect(cardOrb.locator("img")).toBeVisible();
  await page.emulateMedia({ reducedMotion: "no-preference" });

  await card.getByRole("button", { name: "Open Vibe Spending" }).click();
  const hero = page.getByLabel("Spending Vibe orb");
  await expect(hero).toHaveAttribute("data-vibe-orb-motion", "continuous");
  await expect(hero.locator("canvas")).toHaveAttribute("data-vibe-orb-animating", "true");
  const activeDock = page.getByRole("button", { name: "Spending", exact: true });
  await expect(activeDock.locator('[data-vibe-orb-motion="continuous"]')).toHaveAttribute(
    "data-vibe-orb-renderer",
    "webgl",
  );
  await expect(activeDock.locator("canvas")).toHaveAttribute("data-vibe-orb-animating", "true");

  await page.goto("/vibes");
  const row = page.getByRole("button", { name: "Open Vibe Spending" });
  const listOrb = row.locator('[data-vibe-orb-motion="still"]');
  await expect(listOrb).toHaveCount(1);
  await row.focus();
  await row.hover();
  await expect(listOrb).toHaveAttribute("data-vibe-orb-renderer", "raster");
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("dock shortcuts stay rasterized except on hover or keyboard focus, while the active square stays live", async ({
  page,
}) => {
  const store = await installMockStore(page);
  store.vibes[0]!.inferred = {
    "rhizome:vibe-orb": { model: "test", confidence: 1, properties: { ...ORB_PRESETS.bloom } },
  };
  await page.goto(`/vibes/${VIBE_ID}`);
  const active = page.locator("[data-dock-app-slot]");
  await expect(active.locator("canvas")).toHaveAttribute("data-vibe-orb-animating", "true");

  await page.getByRole("button", { name: "Vibe options" }).click();
  await page.getByRole("menuitem", { name: "Pin to dock", exact: true }).click();
  const shortcut = page
    .getByRole("region", { name: "Pinned Vibes", exact: true })
    .getByRole("button", { name: "Spending", exact: true });
  const raster = shortcut.locator('[data-vibe-orb-motion="still"]');
  const canvas = shortcut.locator("canvas");
  await expect(shortcut).toHaveAttribute("aria-current", "true");
  await expect(raster).toHaveAttribute("data-vibe-orb-renderer", "raster");
  await expect(raster.locator("img")).toBeVisible();
  await expect(canvas).toHaveCount(0);
  const imageUrl = await raster.locator("img").getAttribute("src");

  await shortcut.hover();
  await expect(canvas).toHaveAttribute("data-vibe-orb-animating", "true");
  await expect(raster).toHaveCSS("visibility", "hidden");
  // Compare within the moving button: its intentional hover lift must move both layers together.
  expect(await canvas.boundingBox()).toEqual(await raster.locator("img").boundingBox());
  await page.mouse.move(0, 0);
  await expect(canvas).toHaveCount(0);
  await expect(raster.locator("img")).toBeVisible();
  await expect(raster.locator("img")).toHaveAttribute("src", imageUrl!);

  await page.keyboard.press("Tab");
  await shortcut.focus();
  await expect(canvas).toHaveAttribute("data-vibe-orb-animating", "true");
  await shortcut.blur();
  await expect(canvas).toHaveCount(0);

  // Clicking a shortcut may leave DOM focus on it; pointer focus must not keep its canvas alive.
  await shortcut.click();
  await page.mouse.move(0, 0);
  await expect(canvas).toHaveCount(0);
  await expect(active.locator("canvas")).toHaveAttribute("data-vibe-orb-animating", "true");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await shortcut.hover();
  await expect(canvas).toHaveCount(0);
  await expect(active.locator("canvas")).toHaveCount(0);
  await expect(active.locator('[data-vibe-orb-renderer="raster"] img')).toBeVisible();
  await expect(raster.locator("img")).toBeVisible();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(canvas).toHaveAttribute("data-vibe-orb-animating", "true");
  await expect(active.locator("canvas")).toHaveAttribute("data-vibe-orb-animating", "true");

  // If a live context is lost, the cached image becomes visible immediately.
  await canvas.evaluate((element: HTMLCanvasElement) => {
    element.getContext("webgl2")!.getExtension("WEBGL_lose_context")!.loseContext();
  });
  await expect(shortcut.locator('[data-vibe-orb-motion="interaction"]')).toHaveAttribute(
    "data-vibe-orb-renderer",
    "fallback",
  );
  await expect(raster.locator("img")).toBeVisible();
  await expect(raster.locator("img")).toHaveAttribute("src", imageUrl!);
  await page.mouse.move(0, 0);

  await page.getByRole("button", { name: "Vibe options" }).click();
  await page.getByRole("menuitem", { name: "Unpin from dock", exact: true }).click();
  await page.getByRole("button", { name: "Close surface", exact: true }).click();
  await expect(active.locator("canvas")).toHaveCount(0);
  const recent = page.locator("[data-dock-recent-vibes]").getByRole("button", {
    name: "Spending",
    exact: true,
  });
  await expect(recent.locator('[data-vibe-orb-renderer="raster"] img')).toBeVisible();
  await expect(recent.locator("canvas")).toHaveCount(0);
  await recent.hover();
  await expect(recent.locator("canvas")).toHaveAttribute("data-vibe-orb-animating", "true");
  await page.mouse.move(0, 0);
  await expect(recent.locator("canvas")).toHaveCount(0);
});
