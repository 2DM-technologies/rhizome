import { expect, test } from "@rhizome/test-support/playwright";
import { installMockStore, OBJECT_ID, VIBE_ID } from "@rhizome/test-support/mockStore";
import type { OperationDocument } from "@rhizome/store-contract";
import {
  mockSyntheticFileSourceSkill as adapter,
  SYNTHETIC_FILE_FIXTURE,
} from "./support/syntheticSourceSkills.ts";

for (const action of ["cancel", "stale", "confirm"] as const) {
  test(`existing file import reviews a replacement export and handles ${action}`, async ({
    page,
  }) => {
    const store = await installMockStore(page, { sourceSkills: [adapter] });
    const source = `source:${adapter.sourceId}`;
    const oldOrigin = "rnet://origin/0198f2a1-aaaa-7aaa-8aaa-000000000001";
    const sourceDocument = {
      source,
      kind: "origin" as const,
      origin: oldOrigin,
      skill_id: adapter.manifest.skill_id,
      connector_version: adapter.manifest.connector_version,
      parser: adapter.manifest.parser.name,
      parser_version: adapter.manifest.parser.version,
      limits: adapter.manifest.limits,
      created_at: "2026-09-01T00:00:00Z",
    };
    store.ingestionSources.set(source, sourceDocument);
    store.vibes[0]!.pull = { enabled: true, sources: [source], policy: "append_new" };
    const previous = store.objects.get(OBJECT_ID)!;
    previous.user = {
      properties: { notes: "Keep my race note" },
      updated_at: "2026-09-01T00:00:00Z",
    };
    const next = {
      ...previous,
      uri: "rnet://object/0198f2a1-abcd-7abc-8abc-000000000001",
      elements: [],
      user: undefined,
      source: { ...previous.source, properties: { title: "Updated session" } },
    };
    const operation: OperationDocument = {
      operation_id: adapter.operationId,
      kind: "pull",
      status: "done",
      error: null,
      created_at: "2026-09-12T00:00:00Z",
      request: { mode: "import_preview", source },
      result: {
        candidates: [next],
        elements: [],
        verify: {
          ok: true,
          source_record_count: 1,
          candidate_count: 1,
          checks: [{ name: "records", ok: true, detail: "All records verified" }],
        },
        reconciliation: {
          counts: { added: 0, changed: 1, unchanged: 0, absent: 2 },
          changes: [
            {
              previous_object_uri: previous.uri,
              next_object_uri: next.uri,
              previous_properties: previous.source.properties,
              next_properties: next.source.properties,
              preserve_user_annotations: true,
              user_annotations: previous.user.properties,
            },
          ],
        },
      },
    };
    let submitted: unknown;
    let confirmations = 0;
    await page.route(`**/rnet/v0/vibes/${VIBE_ID}/imports`, async (route) => {
      submitted = route.request().postDataJSON();
      await route.fulfill({ status: 202, json: operation });
    });
    await page.route(`**/rnet/v0/operations/${adapter.operationId}`, (route) =>
      route.fulfill({ json: operation }),
    );
    await page.route(
      `**/rnet/v0/vibes/${VIBE_ID}/imports/${adapter.operationId}/confirm`,
      (route) => {
        confirmations++;
        return action === "stale"
          ? route.fulfill({
              status: 422,
              json: {
                type: "https://rhizome.tools/problems/invalid-review",
                title: "Invalid review",
                code: "invalid_review",
                status: 422,
                detail: "Annotations changed after review; create a fresh preview",
              },
            })
          : route.fulfill({ json: store.vibes[0] });
      },
    );
    await page.goto(`/vibes/${VIBE_ID}`);
    await page.getByRole("button", { name: "Import into this Vibe", exact: true }).click();
    await page.getByText(/^Update Synthetic file source import/).click();
    await page
      .getByLabel("New export for Synthetic file source")
      .setInputFiles(SYNTHETIC_FILE_FIXTURE);
    await page.getByRole("button", { name: "Review export update", exact: true }).click();
    const review = page.getByRole("region", { name: "Export update review" });
    await expect(review).toContainText("0 new · 1 changed · 0 unchanged · 2 absent (kept)");
    await review.getByText("Updated session · annotations preserved", { exact: true }).click();
    await expect(review).toContainText("Keep my race note");
    expect(submitted).toEqual({
      source,
      replacement_origin: `rnet://origin/${adapter.originUpload.id}`,
    });
    expect(store.ingestionSources.size).toBe(1);
    expect(
      store.ingestionSources.get(source)?.kind === "origin" && store.ingestionSources.get(source),
    ).toEqual(sourceDocument);
    expect(store.objects.get(OBJECT_ID)).toBe(previous);
    if (action === "cancel") {
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(review).toHaveCount(0);
      expect(confirmations).toBe(0);
    } else {
      await page.getByRole("button", { name: "Confirm import", exact: true }).click();
      if (action === "stale") {
        await expect(page.getByRole("alert")).toContainText("Annotations changed after review");
        await expect(review).toBeVisible();
      } else
        await expect(page.getByRole("status").filter({ hasText: "Updated import:" })).toContainText(
          "Updated import: 0 new, 1 changed",
        );
      expect(confirmations).toBe(1);
    }
  });
}
