import { expect, test } from "@playwright/test";
import type { ObjectInferenceStatus, TaskInferenceStatus } from "@rhizome/store-contract";
import { installMockStore, OBJECT_ID, VIBE_ID } from "./support/mockStore.ts";

test("Vibe polling discovers remote work slowly, follows active work quickly, and slows after completion", async ({
  page,
}) => {
  await page.clock.install();
  const store = await installMockStore(page);
  let status: TaskInferenceStatus["status"] = "idle";
  let reads = 0;
  await page.route("**/rnet/v0/vibes/*/inference-status?*", (route) => {
    const query = new URL(route.request().url()).searchParams;
    const summary = query.get("task") === "summarize";
    if (summary) reads++;
    return route.fulfill({
      json: {
        level: query.get("level"),
        task: query.get("task"),
        status: summary ? status : "idle",
        revision: status === "done" ? 2 : 1,
        operation_id: null,
        message: null,
      },
    });
  });
  await page.goto(`/vibes/${VIBE_ID}`);
  const summary = page.getByRole("region", { name: "Summary", exact: true });
  await expect(summary).toBeVisible();
  await expect.poll(() => reads).toBeGreaterThan(0);
  const idleReads = reads;
  await page.clock.runFor(7_500);
  expect(reads).toBe(idleReads);

  status = "waiting";
  await page.clock.runFor(2_600);
  await expect(page.getByLabel("Summary loading")).toBeVisible();
  const waitingReads = reads;
  status = "running";
  await page.clock.runFor(1_100);
  await expect.poll(() => reads).toBeGreaterThan(waitingReads);

  store.vibes[0]!.inferred = {
    "rhizome:summarize": { model: "test", properties: { summary: "Remote work completed" } },
  };
  status = "done";
  await page.clock.runFor(1_100);
  await expect(summary).toContainText("Remote work completed");
  await expect(page.getByLabel("Summary loading")).toHaveCount(0);
  const doneReads = reads;
  await page.clock.runFor(7_500);
  expect(reads).toBe(doneReads);
});

test("starting a local push immediately refreshes status during the idle interval", async ({
  page,
}) => {
  await page.clock.install();
  await installMockStore(page);
  let reads = 0;
  let started = false;
  await page.route("**/rnet/v0/vibes/*/push", async (route) => {
    started = true;
    await route.fallback();
  });
  await page.route("**/rnet/v0/vibes/*/inference-status?*", (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get("task") === "summarize") reads++;
    return route.fulfill({
      json: {
        level: query.get("level"),
        task: query.get("task"),
        status: started && query.get("task") === "summarize" ? "waiting" : "idle",
        revision: 1,
        operation_id: null,
        message: null,
      },
    });
  });
  await page.goto(`/vibes/${VIBE_ID}`);
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeEnabled();
  await expect.poll(() => reads).toBeGreaterThan(0);
  const before = reads;
  await page.getByRole("button", { name: "Run", exact: true }).click();
  // No clock advance: a push must not wait for the next ten-second idle poll.
  await expect.poll(() => reads).toBeGreaterThan(before);
  await expect(page.getByLabel("Summary loading")).toBeVisible();
});

test("object polling stays fast while any element task is active and slows on error", async ({
  page,
}) => {
  await page.clock.install();
  const store = await installMockStore(page);
  const object = store.objects.get(OBJECT_ID)!;
  const status: ObjectInferenceStatus = {
    records: [
      { uri: object.uri, revision: 0, tasks: [] },
      { uri: object.elements[0]!.uri, revision: 0, tasks: [] },
    ],
  };
  let reads = 0;
  await page.route(`**/rnet/v0/objects/${OBJECT_ID}/inference-status`, (route) => {
    reads++;
    return route.fulfill({ json: status });
  });
  await page.goto(`/objects/${OBJECT_ID}`);
  const element = page.getByLabel("Element 1 inferred", { exact: true });
  await expect(element).toBeVisible();
  await expect.poll(() => reads).toBeGreaterThan(0);
  const idleReads = reads;
  await page.clock.runFor(7_500);
  expect(reads).toBe(idleReads);

  status.records[1]!.tasks = [{ task: "describe-media", status: "running", message: null }];
  await page.clock.runFor(2_600);
  await expect(element.locator(".inferred-block")).toHaveAttribute(
    "data-inference-state",
    "running",
  );
  const runningReads = reads;
  await page.clock.runFor(1_100);
  await expect.poll(() => reads).toBeGreaterThan(runningReads);

  status.records[1]!.tasks = [{ task: "describe-media", status: "error", message: "Try again" }];
  await page.clock.runFor(1_100);
  await expect(element.getByRole("alert")).toHaveText("Try again");
  const errorReads = reads;
  await page.clock.runFor(7_500);
  expect(reads).toBe(errorReads);
});
