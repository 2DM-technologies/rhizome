import { expect, test } from "@playwright/test";
import { installMockStore, OBJECT_ID, VIBE_ID } from "./support/mockStore.ts";

for (const status of ["done", "error"] as const) {
  test(`automatic enrichment refreshes object labels when the pipeline ends ${status}`, async ({
    page,
  }) => {
    const store = await installMockStore(page);
    const vibe = store.vibes.find((item) => item.uri.endsWith(VIBE_ID))!;
    const object = store.objects.get(OBJECT_ID)!;
    object.inferred = {};
    object.elements = [];
    vibe.objects = [object.uri];
    vibe.inferred = {
      "rhizome:vibe-view": {
        model: "test",
        properties: { view: "simplelist", config: { subtitle_pointer: null } },
      },
    };
    let revision = 1;
    await page.route("**/rnet/v0/vibes/*/inference-status?*", (route) =>
      route.fulfill({
        json: {
          level: "vibe",
          task: new URL(route.request().url()).searchParams.get("task"),
          status: revision === 1 ? "waiting" : status,
          revision,
          message: status === "error" && revision > 1 ? "A later inference task failed" : null,
        },
      }),
    );
    await page.goto(`/vibes/${VIBE_ID}`);
    const list = page.locator('[data-vibe-view="simplelist"]');
    await expect(list).toContainText(OBJECT_ID);
    const reads = () =>
      store.requests.filter(
        (request) => new URL(request.url()).pathname === `/rnet/v0/vibes/${VIBE_ID}/objects`,
      ).length;
    const before = reads();
    object.inferred = {
      "rhizome:display-name": { model: "test", properties: { display_name: "New inferred label" } },
    };
    vibe.inferred["rhizome:summarize"] = {
      model: "test",
      properties: { summary: "Fresh summary after import" },
    };
    revision++;
    await expect(page.getByRole("region", { name: "Summary", exact: true })).toContainText(
      "Fresh summary after import",
    );
    await expect(list).toContainText("New inferred label");
    expect(reads()).toBeGreaterThan(before);
  });
}
