import { expect, test } from "@playwright/test";
import { installMockStore, OBJECT_ID, VIBE_ID } from "./support/mockStore.ts";

test("repeat object completion between polls refreshes the rendered result", async ({ page }) => {
  const store = await installMockStore(page);
  const vibe = store.vibes.find((item) => item.uri.endsWith(VIBE_ID))!;
  const object = store.objects.get(OBJECT_ID)!;
  object.elements = [];
  object.inferred = {
    "rhizome:display-name": {
      model: "first-completed-run",
      properties: { display_name: "First completed label" },
    },
  };
  vibe.inferred = {
    "rhizome:vibe-view": {
      model: "test",
      properties: { view: "simplelist", config: { subtitle_pointer: null } },
    },
  };
  let statusReads = 0;
  let operationId = "0198f2a1-1401-7501-8501-999999999991";
  await page.route("**/rnet/v0/vibes/*/inference-status?*", (route) => {
    const query = new URL(route.request().url()).searchParams;
    const task = query.get("task");
    if (task === "display-name") statusReads++;
    return route.fulfill({
      json: {
        level: query.get("level"),
        task,
        status: task === "display-name" ? "done" : "idle",
        revision: 1,
        message: null,
        operation_id: task === "display-name" ? operationId : null,
      },
    });
  });
  const reads = () =>
    store.requests.filter(
      (request) =>
        request.method() === "GET" &&
        new URL(request.url()).pathname === `/rnet/v0/vibes/${VIBE_ID}/objects`,
    ).length;
  await page.goto(`/vibes/${VIBE_ID}`);
  const list = page.locator('[data-vibe-view="simplelist"]');
  await expect(list).toContainText("First completed label");
  await expect.poll(() => statusReads).toBeGreaterThanOrEqual(2);
  const readsBefore = reads();

  // Valid endpoint observations for a second server-started run that starts and completes
  // between status polls: both samples are done, and object writes do not change Vibe rev.
  object.inferred = {
    "rhizome:display-name": {
      model: "second-completed-run",
      properties: { display_name: "Second completed label" },
    },
  };
  operationId = "0198f2a1-1401-7501-8501-999999999992";
  await expect(list).toContainText("Second completed label");
  await expect(list).not.toContainText("First completed label");
  expect(reads()).toBeGreaterThan(readsBefore);
});
