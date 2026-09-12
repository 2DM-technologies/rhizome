import { expect, test } from "@playwright/test";
import { installMockStore, NEW_VIBE_ID } from "./support/mockStore.ts";
import {
  mockSyntheticFileSourceSkill,
  SYNTHETIC_FILE_FIXTURE,
  SYNTHETIC_FILE_INPUT_LABEL,
  syntheticFileSourceSkillManifest,
} from "./support/syntheticSourceSkills.ts";

for (const initial of ["standard", "maximized"] as const) {
  test(`pending import confirmation preserves a mode change from ${initial}`, async ({ page }) => {
    await installMockStore(page, { sourceSkills: [mockSyntheticFileSourceSkill] });
    const requested = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    await page.route("**/rnet/v0/imports/*/confirm", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      requested.resolve();
      await release.promise;
      await route.fallback();
    });
    await page.goto(`/imports${initial === "maximized" ? "?mode=maximized" : ""}`);
    await page.getByLabel(SYNTHETIC_FILE_INPUT_LABEL).setInputFiles(SYNTHETIC_FILE_FIXTURE);
    await page
      .getByRole("button", { name: `Review ${syntheticFileSourceSkillManifest.label}` })
      .click();
    await expect(page.getByLabel("VERIFY reconciliation")).toBeVisible();
    await page.getByRole("button", { name: "Confirm import" }).click();
    await requested.promise;
    const next = initial === "standard" ? "maximized" : "standard";
    try {
      await page
        .getByRole("button", {
          name: initial === "standard" ? "Maximize window" : "Restore window",
        })
        .click();
      await expect(page.locator("[data-view-mode]:not([hidden])")).toHaveAttribute(
        "data-view-mode",
        next,
      );
    } finally {
      release.resolve();
    }
    await expect(page).toHaveURL(
      new RegExp(`/vibes/${NEW_VIBE_ID}${next === "maximized" ? "\\?mode=maximized" : ""}$`),
    );
    await expect(page.locator("[data-view-mode]:not([hidden])")).toHaveAttribute(
      "data-view-mode",
      next,
    );
    await expect
      .poll(() =>
        page.evaluate(
          () => JSON.parse(sessionStorage.getItem("rhizome.shell")!).state.defaultViewMode,
        ),
      )
      .toBe(next);
  });
}
