import { expect, test } from "@playwright/test";

import { installMockStore, VIBE_ID } from "./support/mockStore.ts";

for (const entry of ["Vibes list", "desktop card"] as const) {
  test(`opening a Vibe from the ${entry} never flashes it in the recent dock rail`, async ({
    page,
  }) => {
    await installMockStore(page);
    await page.goto("/");
    if (entry === "Vibes list") {
      await page
        .getByRole("region", { name: "Pinned apps", exact: true })
        .getByRole("button", { name: "Vibes", exact: true })
        .click();
      await expect(page.getByRole("heading", { name: "Vibes", exact: true })).toBeVisible();
    }
    await expect(
      page.getByRole("button", { name: "Open Vibe Spending", exact: true }),
    ).toBeVisible();
    const rail = page.locator("[data-dock-recent-surfaces]");
    await expect(rail).toHaveAttribute("data-count", "0");

    // Inspect intermediate commits, not just the settled dock. A temporary recent shortcut
    // starts a width animation that reverses as soon as that same Vibe becomes active.
    await rail.evaluate((element) => {
      const counts: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          counts.push(record.oldValue ?? "0", element.getAttribute("data-count") ?? "0");
        }
      });
      observer.observe(element, {
        attributes: true,
        attributeFilter: ["data-count"],
        attributeOldValue: true,
      });
      Object.assign(window, {
        __dockNavigationProbe: { counts, stop: () => observer.disconnect() },
      });
    });
    await page.getByRole("button", { name: "Open Vibe Spending", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/vibes/${VIBE_ID}\\?mode=maximized$`));
    await expect(
      page.locator("[data-dock-app-slot]").getByRole("button", { name: "Spending", exact: true }),
    ).toBeVisible();
    await expect(rail).toHaveAttribute("data-count", "0");
    const counts = await page.evaluate(() => {
      const probe = (
        window as typeof window & {
          __dockNavigationProbe: { counts: string[]; stop: () => void };
        }
      ).__dockNavigationProbe;
      probe.stop();
      return probe.counts;
    });
    expect(counts, "the active Vibe must never occupy a temporary recent slot").not.toContain("1");
  });
}
