import { expect, test } from "@playwright/test";
import { installMockStore, OBJECT_ID, VIBE_ID } from "./support/mockStore.ts";

test.beforeEach(async ({ page }) => {
  await installMockStore(page);
});

test("Escape closes the active window, including when focus is outside it", async ({ page }) => {
  await page.goto(`/objects/${OBJECT_ID}`);
  const surface = page.locator(`[data-surface-id="object:${OBJECT_ID}"][data-view-mode]`);
  await expect(surface).toBeVisible();
  await page.getByRole("button", { name: "Home", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/$/);
  await expect(surface).toHaveCount(0);
  // Closing removes the window instead of leaving it hidden for the next Home toggle.
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/vibes\?mode=maximized$/);
});

test("Escape dismisses the launcher before closing the window", async ({ page }) => {
  await page.goto(`/vibes/${VIBE_ID}`);
  const surface = page.locator(`[data-surface-id="vibe:${VIBE_ID}"][data-view-mode]`);
  const search = page.getByRole("searchbox", { name: "Search everything" });
  await search.click();
  await expect(page.getByRole("dialog", { name: "Start something new" })).toBeVisible();
  await search.press("Escape");
  await expect(page.getByRole("dialog", { name: "Start something new" })).toHaveCount(0);
  await expect(surface).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(surface).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});

test("Escape cancels title editing first and leaves remembered routes alone", async ({ page }) => {
  await page.goto(`/vibes/${VIBE_ID}`);
  const surface = page.locator(`[data-surface-id="vibe:${VIBE_ID}"][data-view-mode]`);
  await page.getByRole("button", { name: "Edit Vibe title" }).click();
  const title = page.getByRole("textbox", { name: "Vibe title", exact: true });
  await title.fill("Discard this draft");
  await title.press("Escape");
  await expect(title).toHaveCount(0);
  await expect(surface.getByRole("heading", { name: "Spending", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(surface).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(surface).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(surface).toHaveCount(0);
});
