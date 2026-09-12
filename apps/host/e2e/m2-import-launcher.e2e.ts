import { expect, test, type Page } from "@playwright/test";

import { NEW_VIBE_ID, installMockStore, type MockStore } from "./support/mockStore.ts";
import {
  mockSyntheticFileSourceSkill,
  SYNTHETIC_FILE_FIXTURE,
  SYNTHETIC_FILE_INPUT_LABEL,
  syntheticFileSourceSkillManifest,
} from "./support/syntheticSourceSkills.ts";

let mockStore: MockStore;

test.beforeEach(async ({ page }) => {
  mockStore = await installMockStore(page, { sourceSkills: [mockSyntheticFileSourceSkill] });
});

async function openImportFromLauncher(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search everything" }).click();
  await page
    .locator('[data-launcher-section="Commands"]')
    .getByRole("button", { name: "Import", exact: true })
    .click();
}

test("the start-something-new launcher opens a retained import surface", async ({ page }) => {
  await openImportFromLauncher(page);

  await expect(page).toHaveURL(/\/imports\?mode=maximized$/);
  await expect(page.locator('[data-surface-id="import"][data-view-mode]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "Import", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole("list", { name: "Owned Vibes" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Choose another Vibe" })).toHaveCount(0);
  await expect(page.getByLabel("Import source", { exact: true })).toBeVisible();
});

test("the new-Vibe import flow survives surface history", async ({ page }) => {
  await openImportFromLauncher(page);

  await expect(page.getByLabel("Import source", { exact: true })).toBeVisible();
  await expect(page.getByLabel(SYNTHETIC_FILE_INPUT_LABEL)).toBeAttached();

  await page.getByRole("button", { name: "Home" }).click();
  await expect(page).toHaveURL(/\/vibes\?mode=maximized$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/imports\?mode=maximized$/);
  await expect(page.getByLabel("Import source", { exact: true })).toBeVisible();

  await page.getByLabel(SYNTHETIC_FILE_INPUT_LABEL).setInputFiles(SYNTHETIC_FILE_FIXTURE);
  await page
    .getByRole("button", { name: `Review ${syntheticFileSourceSkillManifest.label}` })
    .click();
  await expect(page.getByLabel("VERIFY reconciliation")).toContainText(
    "2 source records → 2 candidates",
  );
  expect(
    mockStore.requests.some(
      (request) =>
        request.method() === "POST" && new URL(request.url()).pathname === "/rnet/v0/imports",
    ),
  ).toBe(true);
});

test("a new destination is created only when its reviewed import is confirmed", async ({
  page,
}) => {
  await page.goto("/imports");

  await expect(page).toHaveURL(/\/imports$/);
  await expect(page.getByLabel(SYNTHETIC_FILE_INPUT_LABEL)).toBeAttached();
  expect(mockStore.vibes.some((vibe) => vibe.uri.endsWith(`/${NEW_VIBE_ID}`))).toBe(false);

  await page.getByLabel(SYNTHETIC_FILE_INPUT_LABEL).setInputFiles(SYNTHETIC_FILE_FIXTURE);
  await page
    .getByRole("button", { name: `Review ${syntheticFileSourceSkillManifest.label}` })
    .click();
  await expect(page.getByLabel("VERIFY reconciliation")).toContainText(
    "2 source records → 2 candidates",
  );
  await expect(page.getByLabel("New Vibe title")).toHaveCount(0);
  expect(
    mockStore.requests.some(
      (request) =>
        request.method() === "POST" && new URL(request.url()).pathname === "/rnet/v0/imports",
    ),
  ).toBe(true);
  expect(mockStore.vibes.some((vibe) => vibe.uri.endsWith(`/${NEW_VIBE_ID}`))).toBe(false);

  await page.getByRole("button", { name: "Confirm import" }).click();
  await expect(page).toHaveURL(new RegExp(`/vibes/${NEW_VIBE_ID}\\?mode=maximized$`));
  await expect(
    page.getByRole("heading", { name: "Imported objects", exact: true, level: 1 }),
  ).toBeVisible();
  expect(mockStore.vibes.some((vibe) => vibe.title === "Imported objects")).toBe(true);
  expect(
    mockStore.requests.some(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname ===
          `/rnet/v0/imports/${mockSyntheticFileSourceSkill.operationId}/confirm`,
    ),
  ).toBe(true);
});

test("canceling a pending destination leaves no Vibe or committed import", async ({ page }) => {
  await page.goto("/imports");
  await page.getByLabel(SYNTHETIC_FILE_INPUT_LABEL).setInputFiles(SYNTHETIC_FILE_FIXTURE);
  await page
    .getByRole("button", { name: `Review ${syntheticFileSourceSkillManifest.label}` })
    .click();
  await expect(page.getByLabel("VERIFY reconciliation")).toBeVisible();
  await expect(page.getByLabel("New Vibe title")).toHaveCount(0);

  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByRole("status")).toContainText("Nothing was imported");
  expect(mockStore.vibes.some((vibe) => vibe.uri.endsWith(`/${NEW_VIBE_ID}`))).toBe(false);
  expect(
    mockStore.requests.some(
      (request) =>
        request.method() === "POST" && new URL(request.url()).pathname.endsWith("/confirm"),
    ),
  ).toBe(false);
});

test("Start a Vibe opens the import flow directly from Vibes", async ({ page }) => {
  await page.goto("/vibes?mode=maximized");
  await expect(page.getByLabel("New Vibe title")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create Vibe", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Start a Vibe", exact: true }).click();
  await expect(page).toHaveURL(/\/imports\?mode=maximized$/);
  await expect(page.getByLabel("Import source", { exact: true })).toBeVisible();
  await expect(page.getByLabel(SYNTHETIC_FILE_INPUT_LABEL)).toBeAttached();
  expect(
    mockStore.requests.some(
      (request) =>
        request.method() === "POST" && new URL(request.url()).pathname === "/rnet/v0/vibes",
    ),
  ).toBe(false);
});
