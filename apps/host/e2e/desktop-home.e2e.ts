import { expect, test } from "@playwright/test";
import type { Vibe } from "@rnet/types";
import { ORB_PRESETS } from "../src/orb/recipe.ts";

import {
  installMockStore,
  OBJECT_ID,
  PAYLOAD_TEXT,
  VIBE_ID,
  type MockStore,
} from "./support/mockStore.ts";

let mockStore: MockStore;

test.beforeEach(async ({ page }) => {
  mockStore = await installMockStore(page);
});

test("the bare desktop renders live account totals and newest Vibes first", async ({ page }) => {
  await page.setViewportSize({ width: 1728, height: 1117 });
  const base = mockStore.vibes[0];
  if (!base) throw new Error("Missing seeded Vibe");
  mockStore.vibes.push({
    ...structuredClone(base),
    uri: "rnet://vibe/0198f2a1-a09b-76aa-95d8-fc5b55b41fd3",
    title: "Newest",
    updated_at: "2026-09-10T12:00:00.000Z",
  } as Vibe);
  mockStore.dashboardStats = {
    account_created_at: "2024-03-14T12:00:00.000Z",
    objects: 12,
    elements: 34,
    tokens: { input: 5_000, output: 1_700, total: 6_700 },
  };

  await page.goto("/");

  const home = page.getByRole("main", { name: "Home" });
  await expect(home).toBeVisible();
  await expect
    .poll(async () => {
      const parentWidth = await home.evaluate((main) => main.getBoundingClientRect().width);
      return home
        .locator(":scope > div > section")
        .evaluateAll(
          (sections, width) =>
            sections.map((section) =>
              Math.round((section.getBoundingClientRect().width / width) * 100),
            ),
          parentWidth,
        );
    })
    .toEqual([35, 62]);
  await expect(home.getByRole("heading", { name: "Development User" })).toBeVisible();
  await expect(home).toContainText("@noahp");
  await expect(home).toContainText("Member since March 2024");
  await expect(home).toContainText("12");
  await expect(home).toContainText("34");
  await expect(home).toContainText("6,700");

  const cards = home.locator("[data-desktop-vibe-card]");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("Newest");
  await expect(cards.nth(1)).toContainText("Spending");
  await expect(cards.nth(1)).toContainText("1 object");
  await expect(cards.nth(1)).not.toContainText("element");
  await expect(cards.nth(1).locator("[data-vibe-updated-age]")).toHaveText(
    /^(just now|\d+[mhd]|\d+mo|\d+y)$/,
  );
  await expect(cards.nth(1).locator('[data-element-presentation="text"]')).toContainText(
    PAYLOAD_TEXT.trim(),
  );
  await expect
    .poll(() =>
      cards.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height)),
    )
    .toEqual([102, 102]);
  await cards.nth(1).getByRole("button", { name: "Open Vibe Spending" }).click();
  await expect(page).toHaveURL(new RegExp(`/vibes/${VIBE_ID}\\?mode=maximized$`));
});

test("Home unmounts and reopens the most recent window, while a true close falls back to Vibes", async ({
  page,
}) => {
  await page.goto(`/objects/${OBJECT_ID}`);
  const objectSurface = page.locator(`[data-surface-id="object:${OBJECT_ID}"][data-view-mode]`);
  await expect(objectSurface).toBeVisible();

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("main", { name: "Home" })).toBeVisible();
  await expect(objectSurface).toHaveCount(0);

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/objects/${OBJECT_ID}$`));
  await expect(objectSurface).toBeVisible();

  await page.getByRole("button", { name: "Close surface" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/vibes$/);
});

test("desktop panels mount only after the window closes", async ({ page }) => {
  await page.goto(`/objects/${OBJECT_ID}`);
  const home = page.locator("[data-desktop-home]");
  await expect(page.locator("[data-surface-window]")).toBeVisible();
  await expect(home).toHaveCount(0);
  await expect(page.locator("[data-desktop-layer]")).toHaveCount(0);
  // Give any former background preparation a chance to run.
  await page.waitForTimeout(300);
  await expect(home).toHaveCount(0);
  await page.getByRole("button", { name: "Close surface", exact: true }).click();
  await expect(home).toBeVisible();
  await expect(page.locator("[data-surface-window]")).toHaveCount(0);
});

for (const visitedDesktop of [false, true]) {
  test(`closing a window reveals the ${visitedDesktop ? "previously visited" : "first-visit"} desktop without a blank frame`, async ({
    page,
  }) => {
    await page.goto(`/objects/${OBJECT_ID}`);
    const home = page.locator("[data-desktop-home]");
    if (visitedDesktop) {
      await page.getByRole("button", { name: "Home", exact: true }).click();
      await expect(home).toBeVisible();
      await page.getByRole("button", { name: "Home", exact: true }).click();
    }
    await expect(page.locator("[data-surface-window]")).toBeVisible();

    // Record committed DOM states, including the gap a deferred route update can expose
    // after the window store removes its surface. Final-state assertions alone miss it.
    const probe = await page.evaluateHandle(() => {
      const result = { blankStates: 0 };
      const observer = new MutationObserver(() => {
        const windowVisible = Array.from(document.querySelectorAll("[data-surface-window]")).some(
          (element) => element.getClientRects().length > 0,
        );
        const desktopVisible = document
          .querySelector("[data-desktop-home]")
          ?.getClientRects().length;
        if (!windowVisible && !desktopVisible) result.blankStates += 1;
      });
      observer.observe(document.getElementById("root")!, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["hidden"],
      });
      return { result, observer };
    });

    await page.getByRole("button", { name: "Close surface", exact: true }).click();
    await expect(home).toBeVisible();
    await expect(home.getByRole("heading", { name: "My Vibes", exact: true })).toBeVisible();
    await expect(page.locator("[data-surface-window]")).toHaveCount(0);
    const blankStates = await probe.evaluate(({ result, observer }) => {
      observer.disconnect();
      return result.blankStates;
    });
    await probe.dispose();
    expect(blankStates).toBe(0);
  });
}

test("the desktop keeps its DOM while background windows unmount and route shortcuts still work", async ({
  page,
}) => {
  mockStore.vibes[0]!.inferred = {
    "rhizome:vibe-orb": { model: "test", confidence: 1, properties: { ...ORB_PRESETS.bloom } },
  };
  await page.goto("/");
  const home = page.locator("[data-desktop-home]");
  await expect(home.locator('[data-vibe-orb-renderer="raster"] img')).toBeVisible();
  const previousHome = await home.elementHandle();
  await home.getByRole("button", { name: "Open Vibe Spending", exact: true }).click();
  await expect(home).toHaveCount(1);
  await expect(home).toBeHidden();
  expect(await previousHome!.evaluate((element) => element.isConnected)).toBe(true);
  await expect(home.locator("canvas")).toHaveCount(0);

  // Even deliberately remembered background routes must not mount an inactive window.
  await page.evaluate(async (uuid) => {
    const path = "/src/shell/store.ts";
    const { useShellStore } = await import(path);
    useShellStore.getState().openSurface({ kind: "object", uuid }, { keepCurrentOpen: true });
  }, OBJECT_ID);
  await expect(page.locator("[data-surface-window]")).toHaveCount(1);
  await expect(page.locator(`[data-surface-id="object:${OBJECT_ID}"]`)).toHaveCount(0);

  await page.getByRole("button", { name: "Vibe options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit title", exact: true }).click();
  await page.getByRole("textbox", { name: "Vibe title", exact: true }).fill("Renamed desktop vibe");
  await page.getByRole("button", { name: "Save Vibe title", exact: true }).click();
  await expect(home).toBeHidden();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(home).toBeVisible();
  await expect(page.locator("[data-surface-window]")).toHaveCount(0);
  await expect(
    home.getByRole("button", { name: "Open Vibe Renamed desktop vibe", exact: true }),
  ).toBeVisible();
  expect(
    await previousHome!.evaluate(
      (element) => element === document.querySelector("[data-desktop-home]"),
    ),
  ).toBe(true);
  await previousHome!.dispose();
});

test("a retained desktop preserves its scroll position and pauses its clock and live hover", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const base = mockStore.vibes[0]!;
  mockStore.vibes.splice(
    0,
    mockStore.vibes.length,
    ...Array.from({ length: 30 }, (_, index) => ({
      ...structuredClone(base),
      uri: `rnet://vibe/0198f2a1-a09b-76aa-95d8-${String(index + 100).padStart(12, "0")}`,
      title: `Desktop ${index}`,
      inferred: { "rhizome:vibe-orb": { model: "test", properties: { ...ORB_PRESETS.bloom } } },
    })),
  );
  await page.addInitScript(() => {
    const intervals = new Set<number>();
    const setInterval = window.setInterval;
    const clearInterval = window.clearInterval;
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const id = setInterval(handler, timeout, ...args);
      if (timeout === 60_000) intervals.add(id);
      return id;
    }) as typeof window.setInterval;
    window.clearInterval = ((id?: number) => {
      intervals.delete(id!);
      clearInterval(id);
    }) as typeof window.clearInterval;
    Object.defineProperty(window, "__desktopClocks", { value: intervals });
  });
  const clocks = () =>
    page.evaluate(
      () => (window as unknown as { __desktopClocks: Set<number> }).__desktopClocks.size,
    );
  await page.goto("/");
  const home = page.locator("[data-desktop-home]");
  const scroller = home.locator("section").last().locator(".overflow-y-auto");
  await expect(home.locator("[data-desktop-vibe-card]")).toHaveCount(30);
  await scroller.evaluate((element) => {
    element.scrollTop = 180;
  });
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(180);
  const originalScroller = await scroller.elementHandle();
  const card = home.locator("[data-desktop-vibe-card]").nth(4);
  await card.hover();
  await expect(card.locator('[data-vibe-orb-renderer="webgl"]')).toHaveCount(1);
  await expect.poll(clocks).toBe(1);
  // Open from outside the card, so pausing the desktop must clean up its active hover itself.
  await page.getByRole("button", { name: "Home", exact: true }).press("Enter");
  await expect(home).toBeHidden();
  await expect(page.locator("[data-surface-window]")).toHaveCount(1);
  await expect(home.locator("canvas")).toHaveCount(0);
  await expect.poll(clocks).toBe(0);
  await page.mouse.move(0, 0);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(home).toBeVisible();
  await expect(page.locator("[data-surface-window]")).toHaveCount(0);
  expect(await originalScroller!.evaluate((element) => element.isConnected)).toBe(true);
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(180);
  await expect.poll(clocks).toBe(1);
  await page.waitForTimeout(150);
  await expect(home.locator("canvas")).toHaveCount(0);
  await expect(card.locator('[data-vibe-orb-renderer="raster"] img')).toBeVisible();
  await originalScroller!.dispose();
});
