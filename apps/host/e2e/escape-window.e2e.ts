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

test("Escape in the JSON editor preserves the draft and its window", async ({ page }) => {
  await page.goto(`/objects/${OBJECT_ID}`);
  const editor = page.getByLabel("User properties, as JSON");
  await editor.fill('{"note":"unsaved draft"}');
  await editor.press("Escape");
  await expect(editor).toHaveValue('{"note":"unsaved draft"}');
  await expect(page).toHaveURL(new RegExp(`/objects/${OBJECT_ID}$`));
  await expect(page.getByRole("button", { name: "Save user properties" })).toBeEnabled();
});

test("Escape keeps a pending title save open", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/rnet/v0/vibes/${VIBE_ID}`, async (route) => {
    if (route.request().method() === "PATCH") await held;
    await route.fallback();
  });
  await page.goto(`/vibes/${VIBE_ID}`);
  await page.getByRole("button", { name: "Vibe options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit title", exact: true }).click();
  const title = page.getByRole("textbox", { name: "Vibe title", exact: true });
  await title.fill("Saved after Escape");
  try {
    await title.press("Enter");
    await expect(title).toHaveAttribute("readonly", "");
    await title.press("Escape");
    await expect(title).toBeVisible();
    await expect(title).toHaveValue("Saved after Escape");
  } finally {
    release();
  }
  await expect(
    page.getByRole("heading", { name: "Saved after Escape", exact: true }),
  ).toBeVisible();
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
  await page.getByRole("button", { name: "Vibe options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit title", exact: true }).click();
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
