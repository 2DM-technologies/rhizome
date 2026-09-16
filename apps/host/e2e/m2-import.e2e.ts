import { expect, test, type Page } from "@playwright/test";

import { VIBE_ID, installMockStore, type MockStore } from "./support/mockStore.ts";
import {
  SYNTHETIC_FILE_FIXTURE,
  SYNTHETIC_FILE_INPUT_LABEL,
  SYNTHETIC_FILE_SKILL_LABEL,
  mockSyntheticFileSourceSkill,
} from "./support/syntheticSourceSkills.ts";

const cases = [
  {
    name: "synthetic file",
    path: SYNTHETIC_FILE_FIXTURE,
    filename: "synthetic-source.json",
    parser: "synthetic-records",
    candidateCount: 2,
    total: "No aggregate totals",
  },
] as const;

let mockStore: MockStore;

test.beforeEach(async ({ page }) => {
  mockStore = await installMockStore(page, {
    sourceSkills: [mockSyntheticFileSourceSkill],
  });
  const target = mockStore.vibes[0];
  if (!target) throw new Error("Missing mocked target Vibe");
  delete target.pull;
});

test("Vibe import opens on demand and preserves a dropped file when collapsed", async ({
  page,
}) => {
  await page.goto(`/vibes/${VIBE_ID}`);
  const toggle = page.getByRole("button", { name: "Import into this Vibe", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByLabel("Import source", { exact: true })).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page
    .getByLabel("Import source", { exact: true })
    .selectOption({ label: SYNTHETIC_FILE_SKILL_LABEL });

  const fileInput = page.getByLabel(SYNTHETIC_FILE_INPUT_LABEL);
  await fileInput.evaluate((input, filename) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["dropped source"], filename, { type: "application/json" }));
    input.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  }, "dropped-source.json");

  await expect(page.getByText("dropped-source.json", { exact: true })).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("dropped-source.json", { exact: true })).toBeHidden();
  await toggle.click();
  await expect(page.getByText("dropped-source.json", { exact: true })).toBeVisible();
  expect(
    await fileInput.evaluate((input: HTMLInputElement) =>
      Array.from(input.files ?? [], ({ name }) => name),
    ),
  ).toEqual(["dropped-source.json"]);
});

async function stageFile(page: Page, fixture: (typeof cases)[number]): Promise<void> {
  await page.goto(`/vibes/${VIBE_ID}`);
  await page.getByRole("button", { name: "Import into this Vibe", exact: true }).click();
  await page
    .getByLabel("Import source", { exact: true })
    .selectOption({ label: SYNTHETIC_FILE_SKILL_LABEL });
  await page.getByLabel(SYNTHETIC_FILE_INPUT_LABEL).setInputFiles(fixture.path);
  await page
    .getByRole("button", { name: `Review ${SYNTHETIC_FILE_SKILL_LABEL}`, exact: true })
    .click();

  const reconciliation = page.getByLabel("VERIFY reconciliation");
  await expect(reconciliation).toBeVisible();
  await expect(reconciliation).toContainText(`${fixture.candidateCount} objects passed VERIFY`);
  await expect(reconciliation).toContainText(
    `${fixture.candidateCount} source records → ${fixture.candidateCount} candidates`,
  );
  await expect(reconciliation).toContainText(fixture.total);
  await expect(page.getByRole("list", { name: "VERIFY checks" }).getByRole("listitem")).toHaveCount(
    2,
  );
  await expect(
    page.getByRole("list", { name: "Candidate media objects" }).locator("[data-import-candidate]"),
  ).toHaveCount(fixture.candidateCount);
  await expect(page.getByText(fixture.filename, { exact: true })).toBeVisible();
}

for (const fixture of cases) {
  test(`${fixture.name} follows the generic reviewed path and refreshes membership only after confirm`, async ({
    page,
  }) => {
    const initialMembership = [...(mockStore.vibes[0]?.objects ?? [])];
    const initialObjectCount = mockStore.objects.size;

    await stageFile(page, fixture);

    expect(mockStore.vibes[0]?.objects).toEqual(initialMembership);
    expect(mockStore.objects.size).toBe(initialObjectCount);
    expect(mockStore.origins.size).toBe(1);
    expect(mockStore.ingestionSources.size).toBe(1);
    const [origin] = [...mockStore.origins.values()];
    const [source] = [...mockStore.ingestionSources.values()];
    expect(origin?.document.label).toBe(fixture.filename);
    expect(origin?.byteLength).toBeGreaterThan(0);
    expect(source?.parser).toBe(fixture.parser);
    expect(source?.kind).toBe("origin");
    if (source?.kind === "origin") expect(source.origin).toBe(origin?.document.uri);
    expect(
      mockStore.requests
        .filter((request) => request.method() === "POST")
        .map((request) => new URL(request.url()).pathname),
    ).toEqual([
      "/rnet/v0/origins",
      "/rnet/v0/ingestion-sources",
      `/rnet/v0/vibes/${VIBE_ID}/imports`,
    ]);
    expect(
      mockStore.requests.filter(
        (request) =>
          request.method() === "POST" &&
          new URL(request.url()).pathname.includes("/imports/") &&
          new URL(request.url()).pathname.endsWith("/confirm"),
      ),
    ).toHaveLength(0);

    await page.getByRole("button", { name: "Confirm import" }).click();

    await expect(page.getByRole("status").filter({ hasText: "Imported" })).toContainText(
      `Imported ${fixture.candidateCount} objects from ${fixture.filename}.`,
    );
    await expect(page.getByLabel("VERIFY reconciliation")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Open object rnet:/ })).toHaveCount(
      initialMembership.length + fixture.candidateCount,
    );
    await expect(page.getByRole("button", { name: "Refresh sources" })).toBeVisible();
    expect(mockStore.vibes[0]?.objects).toHaveLength(
      initialMembership.length + fixture.candidateCount,
    );
    expect(mockStore.objects.size).toBe(initialObjectCount + fixture.candidateCount);
    expect(mockStore.vibes[0]?.pull?.sources).toContain(source?.source);
    expect(
      mockStore.requests.filter(
        (request) =>
          request.method() === "POST" && new URL(request.url()).pathname.endsWith("/confirm"),
      ),
    ).toHaveLength(1);
  });
}

test("cancel abandons a staged generic file review without deleting its raw records", async ({
  page,
}) => {
  const initialMembership = [...(mockStore.vibes[0]?.objects ?? [])];
  const initialObjectCount = mockStore.objects.size;
  await stageFile(page, cases[0]);

  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await expect(page.getByRole("status").filter({ hasText: "Review canceled" })).toHaveText(
    "Review canceled. Nothing was imported.",
  );
  await expect(page.getByLabel("VERIFY reconciliation")).toHaveCount(0);
  expect(mockStore.vibes[0]?.objects).toEqual(initialMembership);
  expect(mockStore.objects.size).toBe(initialObjectCount);
  expect(mockStore.origins.size).toBe(1);
  expect(mockStore.ingestionSources.size).toBe(1);
  expect(
    mockStore.requests.filter(
      (request) =>
        request.method() === "POST" && new URL(request.url()).pathname.endsWith("/confirm"),
    ),
  ).toHaveLength(0);
});

test("an unsupported synthetic file fails locally before any origin is uploaded", async ({
  page,
}) => {
  await page.goto(`/vibes/${VIBE_ID}`);
  await page.getByRole("button", { name: "Import into this Vibe", exact: true }).click();
  await page
    .getByLabel("Import source", { exact: true })
    .selectOption({ label: SYNTHETIC_FILE_SKILL_LABEL });

  await page.getByLabel(SYNTHETIC_FILE_INPUT_LABEL).setInputFiles({
    name: "unsupported.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not a supported synthetic source"),
  });
  await page
    .getByRole("button", { name: `Review ${SYNTHETIC_FILE_SKILL_LABEL}`, exact: true })
    .click();

  await expect(page.getByRole("alert")).toHaveText(
    `Choose a file accepted by ${SYNTHETIC_FILE_SKILL_LABEL}.`,
  );
  expect(mockStore.origins.size).toBe(0);
  expect(mockStore.ingestionSources.size).toBe(0);
  expect(
    mockStore.requests.filter(
      (request) =>
        request.method() === "POST" && new URL(request.url()).pathname === "/rnet/v0/origins",
    ),
  ).toHaveLength(0);
});
