import { expect, test } from "@playwright/test";
import { storeTaskKey } from "@rhizome/store-contract";

import { PUSH_TASKS } from "../src/api/generated/push-tasks.ts";
import { ORB_PRESETS } from "../src/orb/recipe.ts";
import { installMockStore, VIBE_ID } from "./support/mockStore.ts";

const PLAYGROUND = "/playgrounds/vibe-orb";

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
