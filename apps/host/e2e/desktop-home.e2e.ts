import { expect, test } from "@playwright/test";
import type { Vibe } from "@rnet/types";

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
    "x-rhizome-updated-at": "2026-09-10T12:00:00.000Z",
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
  await expect(home).toContainText("@noah");
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

test("Home hides and restores the most recent window, while a true close falls back to Vibes", async ({
  page,
}) => {
  await page.goto(`/objects/${OBJECT_ID}`);
  const objectSurface = page.locator(`[data-surface-id="object:${OBJECT_ID}"][data-view-mode]`);
  await expect(objectSurface).toBeVisible();

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("main", { name: "Home" })).toBeVisible();
  await expect(objectSurface).toBeHidden();

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/objects/${OBJECT_ID}$`));
  await expect(objectSurface).toBeVisible();

  await page.getByRole("button", { name: "Close surface" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/vibes$/);
});
