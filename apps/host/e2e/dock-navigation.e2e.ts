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

    // Inspect intermediate commits, not just the settled dock. The target must never flash
    // in recents before it becomes active, even when the previous window is added there.
    await rail.evaluate((element) => {
      const addedLabels: (string | null)[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue;
            if (node.matches("button")) addedLabels.push(node.getAttribute("aria-label"));
            addedLabels.push(
              ...[...node.querySelectorAll("button")].map((button) => button.ariaLabel),
            );
          }
        }
      });
      observer.observe(element, { childList: true, subtree: true });
      Object.assign(window, {
        __dockNavigationProbe: { addedLabels, stop: () => observer.disconnect() },
      });
    });
    await page.getByRole("button", { name: "Open Vibe Spending", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/vibes/${VIBE_ID}\\?mode=maximized$`));
    await expect(
      page.locator("[data-dock-app-slot]").getByRole("button", { name: "Spending", exact: true }),
    ).toBeVisible();
    await expect(rail).toHaveAttribute("data-count", entry === "Vibes list" ? "1" : "0");
    const addedLabels = await page.evaluate(() => {
      const probe = (
        window as typeof window & {
          __dockNavigationProbe: { addedLabels: (string | null)[]; stop: () => void };
        }
      ).__dockNavigationProbe;
      probe.stop();
      return probe.addedLabels;
    });
    expect(addedLabels, "the active Vibe must never occupy a temporary recent slot").not.toContain(
      "Spending",
    );
  });
}
