import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

import { NEW_VIBE_ID, VIBE_ID, installMockStore, type MockStore } from "./support/mockStore.ts";

const CSV_FIXTURE = fileURLToPath(
  new URL("../../ingest/skills/csv/fixtures/rhizome-bank.csv", import.meta.url),
);

let mockStore: MockStore;

test.beforeEach(async ({ page }) => {
  mockStore = await installMockStore(page);
});

async function openImportFromLauncher(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search everything" }).click();
  await page
    .locator('[data-launcher-section="Commands"]')
    .getByRole("button", { name: "Import transactions", exact: true })
    .click();
}

test("the start-something-new launcher opens a retained import surface", async ({ page }) => {
  await openImportFromLauncher(page);

  await expect(page).toHaveURL(/\/imports$/);
  await expect(page.locator('[data-surface-id="import"][data-view-mode]')).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Import transactions", exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Owned Vibes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import into Spending" })).toBeVisible();
  await expect(page.getByLabel("New import Vibe title")).toBeVisible();
});

test("an existing owner Vibe hands off to the shared review and survives surface history", async ({
  page,
}) => {
  await openImportFromLauncher(page);
  await page.getByRole("button", { name: "Import into Spending" }).click();

  await expect(page.getByText("Target Vibe: Spending", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Transaction export file")).toBeAttached();

  await page.getByRole("button", { name: "Home" }).click();
  await expect(page).toHaveURL(/\/vibes$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/imports$/);
  await expect(page.getByText("Target Vibe: Spending", { exact: true })).toBeVisible();

  await page.getByLabel("Transaction export file").setInputFiles(CSV_FIXTURE);
  await expect(page.getByLabel("VERIFY reconciliation")).toContainText(
    "3 source records → 3 candidates",
  );
  expect(
    mockStore.requests.some(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === `/rnet/v0/vibes/${VIBE_ID}/imports`,
    ),
  ).toBe(true);
});

test("creating a target Vibe continues directly into the shared import review", async ({
  page,
}) => {
  await page.goto("/imports");
  await page.getByLabel("New import Vibe title").fill("Quarterly taxes");
  await page.getByRole("button", { name: "Create and continue" }).click();

  await expect(page).toHaveURL(/\/imports$/);
  await expect(page.getByText("Target Vibe: Quarterly taxes", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Transaction export file")).toBeAttached();
  expect(mockStore.vibes.some((vibe) => vibe.title === "Quarterly taxes")).toBe(true);

  await page.getByLabel("Transaction export file").setInputFiles(CSV_FIXTURE);
  await expect(page.getByLabel("VERIFY reconciliation")).toContainText(
    "3 source records → 3 candidates",
  );
  expect(
    mockStore.requests.some(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === `/rnet/v0/vibes/${NEW_VIBE_ID}/imports`,
    ),
  ).toBe(true);
});
