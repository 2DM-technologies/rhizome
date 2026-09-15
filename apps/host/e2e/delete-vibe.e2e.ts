import { expect, test } from "@playwright/test";

import { installMockStore, VIBE_ID } from "./support/mockStore.ts";

test("delete confirmation is modal and cancellation preserves the Vibe and window", async ({
  page,
}) => {
  const store = await installMockStore(page);
  await page.goto(`/vibes/${VIBE_ID}`);
  const options = page.getByRole("button", { name: "Vibe options" });
  const dialog = page.getByRole("alertdialog", { name: "Delete Vibe?" });

  await options.click();
  await page.getByRole("menuitem", { name: "Delete Vibe" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Spending");
  expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true);

  const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
  const confirm = dialog.getByRole("button", { name: "Confirm delete Vibe" });
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cancel).toBeFocused();
  await cancel.click();
  await expect(dialog).toHaveCount(0);
  await expect(options).toBeFocused();

  await options.click();
  await page.getByRole("menuitem", { name: "Delete Vibe" }).click();
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(options).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`/vibes/${VIBE_ID}$`));
  await expect(page.getByRole("heading", { name: "Spending", exact: true })).toBeVisible();
  expect(store.requests.filter((request) => request.method() === "DELETE")).toHaveLength(0);
});

test("delete confirmation stays modal while pending and displays errors before retry", async ({
  page,
}) => {
  const store = await installMockStore(page);
  await page.goto(`/vibes/${VIBE_ID}`);
  const responseReady = Promise.withResolvers<void>();
  let deleteRequests = 0;
  await page.route(`**/rnet/v0/vibes/${VIBE_ID}`, async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    deleteRequests += 1;
    if (deleteRequests > 1) return route.fallback();
    await responseReady.promise;
    await route.fulfill({
      status: 503,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "about:blank",
        title: "Unavailable",
        status: 503,
        code: "unavailable",
        detail: "Could not delete this Vibe. Try again.",
      }),
    });
  });

  await page.getByRole("button", { name: "Vibe options" }).click();
  await page.getByRole("menuitem", { name: "Delete Vibe" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Delete Vibe?" });
  const confirm = dialog.getByRole("button", { name: "Confirm delete Vibe" });
  await confirm.click();
  await expect(confirm).toBeDisabled();
  await expect(confirm).toHaveText("Deleting…");
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/vibes/${VIBE_ID}$`));

  responseReady.resolve();
  await expect(dialog.getByRole("alert")).toContainText("Could not delete this Vibe. Try again.");
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  expect(deleteRequests).toBe(2);
  expect(store.vibes.some((vibe) => vibe.uri.endsWith(`/${VIBE_ID}`))).toBe(false);
});
