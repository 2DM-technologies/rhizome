import { expect, test } from "@playwright/test";

import {
  ELEMENT_ID,
  ELEMENT_URI,
  installMockStore,
  NEW_VIBE_ID,
  OBJECT_ID,
  OBJECT_URI,
  VIBE_ID,
} from "./support/mockStore.ts";

test.beforeEach(async ({ page }) => {
  await installMockStore(page);
});

test("an object deep link resolves through the real shell and Store client", async ({ page }) => {
  await page.goto(`/objects/${OBJECT_ID}`);

  await expect(page).toHaveURL(new RegExp(`/objects/${OBJECT_ID}$`));
  await expect(page.getByLabel("User properties, as JSON")).toHaveValue(
    JSON.stringify({ reviewed: false }, null, 2),
  );
  await expect(page.getByRole("button", { name: /Object.*maximize window/i })).toBeVisible();
});

test("standard and maximized windows preserve breathing room above the dock", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/m/Geometry");

  const surface = page.locator("[data-view-mode]");
  const window = page.locator("[data-surface-window]");
  const dock = page.locator("[data-shell-dock]");

  await expect(surface).toHaveAttribute("data-view-mode", "standard");
  await expect
    .poll(() => window.boundingBox())
    .toEqual({
      x: 48,
      y: 48,
      width: 1504,
      height: 828,
    });

  await page.getByRole("button", { name: "Geometry — maximize window" }).click();
  await expect(page).toHaveURL(/\/m\/Geometry\?mode=maximized$/);
  await expect(surface).toHaveAttribute("data-view-mode", "maximized");
  await expect
    .poll(() => window.boundingBox())
    .toEqual({
      x: 24,
      y: 24,
      width: 1552,
      height: 852,
    });

  await expect(dock).toBeVisible();
  await expect(dock).toBeInViewport();
  const windowBox = await window.boundingBox();
  const dockBox = await dock.boundingBox();
  expect(windowBox).not.toBeNull();
  expect(dockBox).not.toBeNull();
  expect(dockBox!.y - (windowBox!.y + windowBox!.height)).toBeGreaterThanOrEqual(20);
  expect(dockBox!.y + dockBox!.height).toBeLessThanOrEqual(964);

  await page.getByRole("button", { name: "Geometry — restore standard window" }).click();
  await expect(page).toHaveURL(/\/m\/Geometry$/);
  await expect
    .poll(() => window.boundingBox())
    .toEqual({
      x: 48,
      y: 48,
      width: 1504,
      height: 828,
    });
});

test("back and forward focus surfaces without remounting their local state", async ({ page }) => {
  await page.goto(`/vibes/${VIBE_ID}`);
  await page.getByRole("button").filter({ hasText: OBJECT_URI }).click();

  const editor = page.getByLabel("User properties, as JSON");
  await expect(editor).toBeVisible();
  await editor.fill('{"reviewed":"draft"}');

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/vibes/${VIBE_ID}$`));
  await expect(editor).toBeHidden();
  await expect(editor).toHaveValue('{"reviewed":"draft"}');

  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/objects/${OBJECT_ID}$`));
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue('{"reviewed":"draft"}');
});

test("Vibe CRUD and membership use the existing Store object", async ({ page }) => {
  await page.goto("/vibes");
  await expect(page.getByRole("button", { name: "Open Vibe Spending" })).toBeVisible();

  await page.getByLabel("New Vibe title").fill("Trip planning");
  await page.getByRole("button", { name: "Create Vibe" }).click();
  await expect(page).toHaveURL(new RegExp(`/vibes/${NEW_VIBE_ID}$`));

  const title = page.getByLabel("Vibe title", { exact: true });
  await expect(title).toHaveValue("Trip planning");
  await title.fill("Summer trip");
  await page.getByRole("button", { name: "Rename Vibe" }).click();
  await page.getByRole("button", { name: "Home" }).click();
  const renamedVibe = page.getByRole("button", { name: "Open Vibe Summer trip" });
  await expect(renamedVibe).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Vibe Trip planning" })).toHaveCount(0);
  await renamedVibe.click();

  await page.getByLabel("Object URI").fill(OBJECT_URI);
  await page.getByRole("button", { name: "Add object" }).click();
  const object = page.getByRole("button", { name: `Open object ${OBJECT_URI}` });
  await expect(object).toBeVisible();

  await page.getByRole("button", { name: `Remove ${OBJECT_URI} from Vibe` }).click();
  await expect(object).toBeHidden();
  await expect(page.getByText("This Vibe has no objects yet.")).toBeVisible();

  await page.getByLabel("Object URI").fill(OBJECT_URI);
  await page.getByRole("button", { name: "Add object" }).click();
  await expect(object).toBeVisible();

  await page.getByRole("button", { name: "Home" }).click();
  await expect(renamedVibe).toContainText("1 objects");
  await renamedVibe.click();

  await page.getByRole("button", { name: "Delete Vibe" }).click();
  await page.getByRole("button", { name: "Confirm delete Vibe" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/vibes");
  await expect(page.getByRole("button", { name: "Open Vibe Spending" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Vibe Summer trip" })).toHaveCount(0);
});

test("a granted Vibe is browseable without exposing owner-only controls", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "rhizome.session",
      JSON.stringify({ state: { token: "dev:user:other" }, version: 0 }),
    );
  });
  await page.goto(`/vibes/${VIBE_ID}`);

  await expect(page.getByRole("button", { name: `Open object ${OBJECT_URI}` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rename Vibe" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete Vibe" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add object" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Remove ${OBJECT_URI} from Vibe` })).toHaveCount(0);

  await page.getByRole("button", { name: `Open object ${OBJECT_URI}` }).click();
  await expect(page.getByRole("button", { name: "Save user properties" })).toHaveCount(0);
  await expect(page.getByText('"reviewed": false')).toBeVisible();
});

test("user-property edits survive a reload", async ({ page }) => {
  await page.goto(`/objects/${OBJECT_ID}`);

  const editor = page.getByLabel("User properties, as JSON");
  await editor.fill(JSON.stringify({ reviewed: true, category: "budget" }, null, 2));
  await page.getByRole("button", { name: "Save user properties" }).click();
  await expect(page.getByText("saved", { exact: true })).toBeVisible();

  await page.reload();
  await expect(editor).toHaveValue(JSON.stringify({ reviewed: true, category: "budget" }, null, 2));
});

test("an existing element payload is fetched and presented", async ({ page }) => {
  const payloadResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/elements/${ELEMENT_ID}/bytes`),
  );
  await page.goto(`/objects/${OBJECT_ID}`);
  await payloadResponse;

  const label = `Payload for ${ELEMENT_URI}`;
  await expect(page.getByTitle(label)).toBeVisible();
  const download = page.getByRole("link", { name: `Download payload ${ELEMENT_URI}` });
  await download.scrollIntoViewIfNeeded();
  await expect(download).toBeInViewport();
  await expect(download).toHaveAttribute("href", /^blob:/);
});

test("home opens the Vibes surface from the bare desktop", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /home/i }).click();
  await expect(page).toHaveURL(/\/vibes$/);
  await expect(page.getByText("Spending", { exact: true })).toBeVisible();
});

test("launcher search opens a loaded Vibe by title", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /home/i }).click();
  await page.getByRole("button", { name: /start something new/i }).click();
  const launcher = page.getByRole("textbox", { name: /search everything/i });
  await launcher.fill("spend");
  await launcher.press("Shift+Tab");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /start something new/i })).toBeFocused();

  await page.getByRole("button", { name: /start something new/i }).click();
  await page.getByRole("textbox", { name: /search everything/i }).fill("spend");
  await page.getByRole("button", { name: "Spending" }).click();
  await expect(page).toHaveURL(new RegExp(`/vibes/${VIBE_ID}$`));
});
