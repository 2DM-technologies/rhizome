import { expect, test, type Page } from "@playwright/test";

import { installMockStore, OBJECT_ID, PAYLOAD_TEXT } from "./support/mockStore.ts";
import { mockSyntheticFileSourceSkill } from "./support/syntheticSourceSkills.ts";

type Theme = "light" | "dark";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await installMockStore(page, { sourceSkills: [mockSyntheticFileSourceSkill] });
});

async function expectTheme(page: Page, theme: Theme) {
  const dark = theme === "dark";
  await expect(page.locator("html")).toHaveCSS("color-scheme", theme);
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    dark ? "rgb(14, 18, 20)" : "rgb(255, 255, 255)",
  );
  await expect(page.locator(".desktop-wallpaper")).toHaveCSS(
    "background-image",
    dark ? /wallpaper-dark(?:-[\w-]+)?\.png/ : /linear-gradient.*wallpaper(?:-[\w-]+)?\.png/,
  );
  const dock = page.locator('[data-shell-dock] > [data-tier="content"]');
  await expect(dock).toHaveCSS("color-scheme", dark ? "light" : "dark");
  await expect(page.locator("[data-dock-tray-backdrop]")).toHaveCSS(
    "background-color",
    dark ? "rgba(232, 232, 226, 0.82)" : "color(srgb 0.0666667 0.0666667 0.0666667 / 0.9)",
  );
  const search = page.getByRole("searchbox", { name: "Search everything" });
  await expect(search).toHaveCSS("color-scheme", theme);
  await expect(search).toHaveCSS("color", dark ? "rgb(255, 255, 255)" : "rgb(20, 21, 26)");
  await expect(page.locator("[data-launcher-surface]")).toHaveCSS(
    "background-color",
    dark ? "rgba(22, 25, 28, 0.9)" : "rgba(255, 255, 250, 0.9)",
  );
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme} system preference themes home, windows, previews, and the inverted dock`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/");
    await expectTheme(page, theme);

    const home = page.getByRole("main", { name: "Home" });
    await expect(home.getByRole("heading", { name: "Development User" })).toBeVisible();
    await expect(home.locator('[data-element-presentation="text"]')).toContainText(
      PAYLOAD_TEXT.trim(),
    );
    await expect(home.locator("section").first()).toHaveCSS(
      "background-color",
      theme === "dark" ? "rgba(22, 25, 28, 0.92)" : "rgba(255, 255, 255, 0.28)",
    );
    await page.screenshot({
      path: testInfo.outputPath(`home-${theme}.png`),
      animations: "disabled",
    });

    await page.goto(`/objects/${OBJECT_ID}`);
    const window = page.locator("[data-surface-window]");
    const payload = window.locator('pre[data-element-presentation="text"]');
    await expect(payload).toContainText(PAYLOAD_TEXT.trim());
    for (const surface of [window, payload]) {
      await expect(surface).toHaveCSS(
        "background-color",
        theme === "dark" ? "rgb(14, 18, 20)" : "rgb(255, 255, 255)",
      );
      await expect(surface).toHaveCSS("color-scheme", theme);
    }

    const search = page.getByRole("searchbox", { name: "Search everything" });
    await search.click();
    await expect(page.getByRole("dialog", { name: "Start something new" })).toBeVisible();
    await expectTheme(page, theme);
    const item = page.locator("[data-launcher-item-rail] button").first();
    await item.hover();
    await expect(item).toHaveCSS(
      "background-color",
      theme === "dark" ? "rgb(39, 43, 48)" : "rgb(231, 231, 226)",
    );
    await page.screenshot({
      path: testInfo.outputPath(`window-${theme}.png`),
      animations: "disabled",
    });

    await page.goto("/imports");
    const source = page.getByRole("combobox", { name: "Import source", exact: true });
    await expect(source).toBeVisible();
    await expect(source).toHaveCSS("color-scheme", theme);
    await expect(source).toHaveCSS(
      "background-color",
      theme === "dark" ? "rgb(14, 18, 20)" : "rgb(255, 255, 255)",
    );
    await source.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(source).toBeFocused();
    await expect(source).toHaveCSS("outline-style", "solid");
    await expect(source).toHaveCSS("outline-width", "2px");
  });
}

test("live system changes preserve the mounted window, unsaved edits, and focused search", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`/objects/${OBJECT_ID}`);
  const editor = page.getByRole("textbox", { name: "User properties, as JSON" });
  const draft = '{"notes":"Keep this unsaved edit"}';
  await editor.fill(draft);
  const search = page.getByRole("searchbox", { name: "Search everything" });
  await search.fill("Spending");
  const originalEditor = await editor.elementHandle();
  const originalWindow = await page.locator("[data-surface-window]").elementHandle();
  const originalSearch = await search.elementHandle();

  for (const theme of ["dark", "light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expectTheme(page, theme);
    await expect(editor).toHaveValue(draft);
    await expect(editor).toHaveCSS("color-scheme", theme);
    await expect(search).toHaveValue("Spending");
    await expect(search).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`/objects/${OBJECT_ID}$`));
    expect(await originalEditor?.evaluate((node) => node.isConnected)).toBe(true);
    expect(await originalWindow?.evaluate((node) => node.isConnected)).toBe(true);
    expect(await originalSearch?.evaluate((node) => node.isConnected)).toBe(true);
  }
});
