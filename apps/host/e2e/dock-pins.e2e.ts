import { expect, test } from "@playwright/test";

import { installMockStore, VIBE_ID } from "./support/mockStore.ts";

test.beforeEach(async ({ page }) => {
  await installMockStore(page);
});

test("expanding search pushes the pinned apps right without moving the input", async ({ page }) => {
  await page.goto("/");
  const slot = page.locator("[data-launcher-slot]");
  const pinned = page.getByRole("region", { name: "Pinned apps", exact: true });
  const vibes = pinned.getByRole("button", { name: "Vibes", exact: true });
  const before = await vibes.boundingBox();
  const input = page.getByRole("searchbox", { name: "Search everything" });
  const inputBefore = await input.boundingBox();

  await input.click();
  await expect(slot).toHaveCSS("width", "308px");
  await expect.poll(async () => (await vibes.boundingBox())!.x - before!.x).toBe(68);
  expect((await input.boundingBox())!.x).toBe(inputBefore!.x);
  await expect(vibes.locator("svg")).toBeVisible();
  await expect(
    pinned.getByRole("button", { name: "Ingest", exact: true }).locator("svg"),
  ).toBeVisible();

  await input.press("Escape");
  await expect(slot).toHaveCSS("width", "240px");
  await expect.poll(async () => (await vibes.boundingBox())!.x).toBe(before!.x);
});

test("a Vibe can be pinned, reopened from a fresh session, and unpinned", async ({
  page,
  context,
}) => {
  await page.goto(`/vibes/${VIBE_ID}`);
  await page.getByRole("button", { name: "Vibe options" }).click();
  await page.getByRole("menuitem", { name: "Pin to dock", exact: true }).click();

  const pinned = page.getByRole("region", { name: "Pinned Vibes", exact: true });
  await expect(pinned.getByRole("button", { name: "Spending", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page.locator("[data-dock-app-slot]")).toHaveAttribute("data-present", "true");
  await expect(
    page.locator("[data-dock-app-slot]").getByRole("button", { name: "Spending", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-dock-recent-vibes]")).toHaveAttribute("data-count", "0");

  // New tabs share local storage but do not inherit this tab's session storage.
  const fresh = await context.newPage();
  await installMockStore(fresh);
  await fresh.goto("/");
  const shortcut = fresh
    .getByRole("region", { name: "Pinned Vibes", exact: true })
    .getByRole("button", { name: "Spending", exact: true });
  await expect(shortcut).toBeVisible();
  await shortcut.click();
  await expect(fresh).toHaveURL(new RegExp(`/vibes/${VIBE_ID}\\?mode=maximized$`));
  await expect(
    fresh.locator("[data-dock-app-slot]").getByRole("button", { name: "Spending", exact: true }),
  ).toBeVisible();
  await expect(shortcut).toBeVisible();
  expect(
    await shortcut.evaluate((element) => getComputedStyle(element, "::after").content),
  ).not.toBe("none");
  await fresh.getByRole("button", { name: "Vibe options" }).click();
  const unpin = fresh.getByRole("menuitem", { name: "Unpin from dock", exact: true });
  await unpin.press("Escape");
  await expect(fresh.getByRole("menu", { name: "Vibe options" })).toHaveCount(0);
  await expect(fresh.locator("[data-surface-window]")).toHaveCount(1);
  await expect(fresh.getByRole("button", { name: "Vibe options" })).toBeFocused();
  await fresh.getByRole("button", { name: "Vibe options" }).click();
  await unpin.click();
  await expect(fresh.getByRole("region", { name: "Pinned Vibes", exact: true })).toHaveCount(0);
  await expect(pinned).toHaveCount(0);
  await fresh.reload();
  await expect(fresh.getByRole("region", { name: "Pinned Vibes", exact: true })).toHaveCount(0);
});
