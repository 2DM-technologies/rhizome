import { expect, test } from "@playwright/test";
import { storeTaskKey } from "@rhizome/store-contract";

import { PUSH_TASKS } from "../src/api/generated/push-tasks.ts";
import { installMockStore } from "./support/mockStore.ts";

const PLAYGROUND = "/playgrounds/vibe-orb";

test("the shared glass material leaves only interior controls and energy", async ({
  page,
}, testInfo) => {
  await page.goto(PLAYGROUND);
  await expect(page.locator('[data-vibe-orb-renderer="webgl"]')).toHaveCount(9);
  await expect(page.getByRole("group", { name: "Surface", exact: true })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Response", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("group", { name: "Field", exact: true }).getByRole("slider"),
  ).toHaveCount(3);
  const energy = page.getByRole("slider", { name: "Energy", exact: true });
  await expect(
    page.getByRole("group", { name: "Motion", exact: true }).getByRole("slider"),
  ).toHaveCount(1);
  await energy.focus();
  await energy.press("End");
  await expect(energy).toHaveValue("1");
  await expect(
    page.getByLabel("Large procedural Vibe orb preview").locator("canvas"),
  ).toHaveAttribute("data-vibe-orb-animating", "true");
  await energy.press("Home");
  await expect(energy).toHaveValue("0");
  await expect(
    page.getByLabel("Large procedural Vibe orb preview").locator("canvas"),
  ).toHaveAttribute("data-vibe-orb-animating", "true");
  await page.screenshot({ path: testInfo.outputPath("shared-glass-controls.png"), fullPage: true });
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
  await expect(large.locator("canvas")).toHaveCSS("opacity", "0");
  await expect(large.locator("span[aria-hidden]")).toHaveCSS("opacity", "1");
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

test("persisted Vibe recipes drive card, list, dock, and hero motion policies", async ({
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
        version: 2,
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
        energy: 0.55,
      },
    },
  };

  await page.goto("/");
  const card = page.locator("[data-desktop-vibe-card]").filter({ hasText: "Spending" });
  const cardOrb = card.locator('[data-vibe-orb-motion="interaction"]');
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
  await expect(cardOrb).toHaveAttribute("data-vibe-orb-renderer", "webgl");
  const cardIdentityOrder = await card.evaluate((element) => {
    const orb = element.querySelector("[data-vibe-orb-renderer]")!.getBoundingClientRect();
    const title = element.querySelector("h3")!.getBoundingClientRect();
    return orb.left < title.left;
  });
  expect(cardIdentityOrder).toBe(true);
  await expect(cardOrb.locator("canvas")).toHaveAttribute("data-vibe-orb-animating", "false", {
    timeout: 3_000,
  });
  await card.getByRole("button", { name: "Open Vibe Spending" }).focus();
  await expect(cardOrb.locator("canvas")).toHaveAttribute("data-vibe-orb-animating", "true");

  await card.getByRole("button", { name: "Open Vibe Spending" }).click();
  const hero = page.getByLabel("Spending Vibe orb");
  await expect(hero).toHaveAttribute("data-vibe-orb-motion", "continuous");
  await expect(hero.locator("canvas")).toHaveAttribute("data-vibe-orb-animating", "true");
  const activeDock = page.getByRole("button", { name: "Spending", exact: true });
  await expect(activeDock.locator('[data-vibe-orb-motion="continuous"]')).toHaveCount(1);

  await page.goto("/vibes");
  const row = page.getByRole("button", { name: "Open Vibe Spending" });
  const listOrb = row.locator('[data-vibe-orb-motion="interaction"]');
  await expect(listOrb).toHaveCount(1);
  await row.focus();
  await expect(listOrb.locator("canvas")).toHaveAttribute("data-vibe-orb-animating", "true");
});
