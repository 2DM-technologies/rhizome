import { expect, test } from "@playwright/test";
import { PUSH_TASKS } from "../src/api/generated/push-tasks.ts";

import { installMockStore, OBJECT_ID, VIBE_ID, type MockStore } from "./support/mockStore.ts";

let store: MockStore;
test.beforeEach(async ({ page }) => {
  store = await installMockStore(page);
});

test("object and Vibe pushes poll, refresh inferred data, and render the inferred view", async ({
  page,
}) => {
  await page.goto(`/vibes/${VIBE_ID}`);
  await expect(page.getByText("Monthly plan", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Open object rnet://object/${OBJECT_ID}` }).click();
  await expect(page.getByLabel("User properties, as JSON")).toBeVisible();
  const objectReadsBefore = store.requests.filter(
    (request) =>
      request.method() === "GET" &&
      new URL(request.url()).pathname === `/rnet/v0/objects/${OBJECT_ID}`,
  ).length;
  await page.getByRole("button", { name: "Back" }).click();

  await page.getByLabel("Push task").selectOption(`object:${PUSH_TASKS.object.display_name.name}`);
  await page.getByRole("button", { name: "Run on missing" }).click();
  await expect(page.getByText("Push done", { exact: true })).toBeVisible();
  await expect(page.getByText("Enriched monthly plan", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run on missing" })).toBeDisabled();
  const firstPush = store.requests.find((request) =>
    new URL(request.url()).pathname.endsWith("/push"),
  );
  expect(firstPush?.postDataJSON()).toEqual({
    level: "object",
    task: PUSH_TASKS.object.display_name.name,
    selection: [`rnet://object/${OBJECT_ID}`],
  });

  await page.getByRole("button", { name: "Rerun all" }).click();
  await expect(page.getByRole("button", { name: "Rerun all" })).toBeDisabled();
  await expect
    .poll(
      () =>
        store.requests.filter((request) => new URL(request.url()).pathname.endsWith("/push"))
          .length,
    )
    .toBe(2);
  const rerun = store.requests
    .filter((request) => new URL(request.url()).pathname.endsWith("/push"))
    .at(-1);
  expect(rerun?.postDataJSON()).toEqual({
    level: "object",
    task: PUSH_TASKS.object.display_name.name,
  });
  await expect(page.getByRole("button", { name: "Rerun all" })).toBeEnabled();

  await page.getByRole("button", { name: `Open object rnet://object/${OBJECT_ID}` }).click();
  await expect(page.locator("pre").filter({ hasText: "rhizome:display_name" })).toContainText(
    "Enriched monthly plan",
  );
  await expect
    .poll(
      () =>
        store.requests.filter(
          (request) =>
            request.method() === "GET" &&
            new URL(request.url()).pathname === `/rnet/v0/objects/${OBJECT_ID}`,
        ).length,
    )
    .toBeGreaterThan(objectReadsBefore);
  await page.getByRole("button", { name: "Back" }).click();

  await page.getByLabel("Push task").selectOption(`vibe:${PUSH_TASKS.vibe.vibe_view.name}`);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByLabel("Inferred Vibe view")).toHaveAttribute(
    "data-vibe-view",
    "simplelist",
  );
  await expect(
    page.getByLabel("Inferred Vibe view").getByText("Monthly plan", { exact: true }),
  ).toBeVisible();

  await page.getByLabel("Push task").selectOption(`vibe:${PUSH_TASKS.vibe.summarize.name}`);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
  await expect(page.getByText("A focused collection of monthly planning notes.")).toBeVisible();
});
