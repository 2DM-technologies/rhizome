import { expect, test } from "@playwright/test";
import type { ObjectInferenceStatus } from "@rhizome/store-contract";
import { installMockStore, OBJECT_ID, ELEMENT_ID } from "./support/mockStore.ts";

test("inferred blocks move from gray waiting to Rhizome shimmer, refresh, and retain content on errors", async ({
  page,
}) => {
  const store = await installMockStore(page);
  const object = store.objects.get(OBJECT_ID)!;
  const element = store.elements.get(ELEMENT_ID)!;
  store.objects.set(OBJECT_ID, { ...object, inferred: {} });
  store.elements.set(ELEMENT_ID, { ...element, inferred: {} });
  const status: ObjectInferenceStatus = {
    records: [
      {
        uri: object.uri,
        revision: 0,
        tasks: [{ task: "display_name", status: "waiting", message: null }],
      },
      {
        uri: element.uri,
        revision: 0,
        tasks: [{ task: "describe_media", status: "waiting", message: null }],
      },
    ],
  };
  await page.route(`**/rnet/v0/objects/${OBJECT_ID}/inference-status`, (route) =>
    route.fulfill({ json: status }),
  );
  await page.goto(`/objects/${OBJECT_ID}`);
  const objectBlock = page.getByLabel("Object inferred", { exact: true });
  const elementBlock = page.getByLabel("Element 1 inferred", { exact: true });
  const objectContainer = objectBlock.locator(".inferred-block");
  const elementContainer = elementBlock.locator(".inferred-block");
  await expect(objectContainer).toHaveAttribute("data-inference-state", "waiting");
  await expect(elementContainer).toHaveAttribute("data-inference-state", "waiting");
  await expect(objectBlock.locator(".inferred-skeleton-line")).toHaveCount(8);
  const waitingWave = await objectContainer.evaluate(
    (node) => getComputedStyle(node, "::after").backgroundImage,
  );
  expect(
    await objectContainer.evaluate((node) => getComputedStyle(node, "::after").animationName),
  ).toBe("inferred-shimmer");

  status.records[1]!.tasks[0]!.status = "running";
  await expect(elementContainer).toHaveAttribute("data-inference-state", "running");
  await expect(objectContainer).toHaveAttribute("data-inference-state", "waiting");
  expect(
    await elementContainer.evaluate((node) => getComputedStyle(node, "::after").backgroundImage),
  ).not.toBe(waitingWave);

  const envelope = (properties: Record<string, unknown>) => ({
    model: "openai/gpt-5.6-luna",
    inferred_at: "2026-09-12T00:00:00Z",
    properties,
  });
  store.elements.set(ELEMENT_ID, {
    ...element,
    inferred: { "rhizome:describe_media": envelope({ caption: "A fern in soft light" }) },
  });
  status.records[1]!.revision = 1;
  status.records[1]!.tasks = [];
  status.records[0]!.tasks[0]!.status = "running";
  await expect(elementContainer).toHaveAttribute("data-inference-state", "idle");
  await expect(elementBlock.locator("pre")).toContainText("A fern in soft light");
  await expect(objectContainer).toHaveAttribute("data-inference-state", "running");
  await page.screenshot({ path: "/tmp/rhizome-inference-running.png", fullPage: true });

  store.objects.set(OBJECT_ID, {
    ...object,
    inferred: { "rhizome:display_name": envelope({ display_name: "Garden fern" }) },
  });
  status.records[0]!.revision = 1;
  status.records[0]!.tasks = [];
  await expect(objectBlock.locator("pre")).toContainText("Garden fern");
  await expect(objectContainer).toHaveAttribute("aria-busy", "false");

  status.records[0]!.tasks = [{ task: "display_name", status: "waiting", message: null }];
  await expect(objectContainer).toHaveAttribute("data-inference-state", "waiting");
  await expect(objectBlock.locator("pre")).toContainText("Garden fern");
  status.records[0]!.tasks[0]!.status = "running";
  await expect(objectContainer).toHaveAttribute("data-inference-state", "running");
  await expect(objectBlock.locator("pre")).toContainText("Garden fern");
  status.records[0]!.tasks = [
    { task: "display_name", status: "error", message: "The inference request timed out." },
  ];
  await expect(objectBlock.getByRole("alert")).toHaveText("The inference request timed out.");
  await expect(objectContainer).toHaveAttribute("aria-busy", "false");
  await expect(objectBlock.locator("pre")).toContainText("Garden fern");

  status.records[0]!.tasks = [{ task: "display_name", status: "running", message: null }];
  await expect(objectBlock.getByRole("alert")).toHaveCount(0);
  store.objects.set(OBJECT_ID, {
    ...object,
    inferred: { "rhizome:display_name": envelope({ display_name: "Refreshed garden fern" }) },
  });
  status.records[0]!.revision = 2;
  status.records[0]!.tasks = [];
  await expect(objectBlock.locator("pre")).toContainText("Refreshed garden fern");
  await expect(objectContainer).toHaveAttribute("data-inference-state", "idle");
});

test("reduced motion keeps inference colors without shimmer animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const store = await installMockStore(page);
  store.objects.get(OBJECT_ID)!.inferred = {};
  await page.route(`**/rnet/v0/objects/${OBJECT_ID}/inference-status`, (route) =>
    route.fulfill({
      json: {
        records: [
          {
            uri: `rnet://object/${OBJECT_ID}`,
            revision: 0,
            tasks: [{ task: "display_name", status: "running", message: null }],
          },
        ],
      },
    }),
  );
  await page.goto(`/objects/${OBJECT_ID}`);
  const container = page.getByLabel("Object inferred", { exact: true }).locator(".inferred-block");
  await expect(container).toHaveAttribute("data-inference-state", "running");
  expect(await container.evaluate((node) => getComputedStyle(node, "::after").animationName)).toBe(
    "none",
  );
});
