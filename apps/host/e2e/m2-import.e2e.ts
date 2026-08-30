import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

import { VIBE_ID, installMockStore, type MockStore } from "./support/mockStore.ts";

const cases = [
  {
    name: "CSV",
    path: fileURLToPath(
      new URL("../../ingest/skills/csv/fixtures/rhizome-bank.csv", import.meta.url),
    ),
    filename: "rhizome-bank.csv",
    parser: "csv",
    candidateCount: 3,
    total: "USD 2410.25",
  },
  {
    name: "QFX",
    path: fileURLToPath(new URL("../../ingest/skills/ofx/fixtures/checking.qfx", import.meta.url)),
    filename: "checking.qfx",
    parser: "ofx",
    candidateCount: 2,
    total: "USD 2493.50",
  },
] as const;

let mockStore: MockStore;

test.beforeEach(async ({ page }) => {
  mockStore = await installMockStore(page);
  const target = mockStore.vibes[0];
  if (!target) throw new Error("Missing mocked target Vibe");
  delete target.pull;
});

async function stageFile(page: Page, fixture: (typeof cases)[number]): Promise<void> {
  await page.goto(`/vibes/${VIBE_ID}`);
  await page.getByLabel("Transaction export file").setInputFiles(fixture.path);

  const reconciliation = page.getByLabel("VERIFY reconciliation");
  await expect(reconciliation).toBeVisible();
  await expect(reconciliation).toContainText(
    `${fixture.candidateCount} transactions passed VERIFY`,
  );
  await expect(reconciliation).toContainText(
    `${fixture.candidateCount} source records → ${fixture.candidateCount} candidates`,
  );
  await expect(reconciliation).toContainText(fixture.total);
  await expect(page.getByRole("list", { name: "VERIFY checks" }).getByRole("listitem")).toHaveCount(
    4,
  );
  await expect(page.locator("[data-import-candidate]")).toHaveCount(fixture.candidateCount);
  await expect(page.getByText(fixture.filename, { exact: true })).toBeVisible();
}

for (const fixture of cases) {
  test(`${fixture.name} follows the reviewed path and refreshes membership only after confirm`, async ({
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

    await expect(page.getByRole("status")).toContainText(
      `Imported ${fixture.candidateCount} transactions from ${fixture.filename}.`,
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

test("cancel abandons the staged CSV review without committing or deleting its raw records", async ({
  page,
}) => {
  const initialMembership = [...(mockStore.vibes[0]?.objects ?? [])];
  const initialObjectCount = mockStore.objects.size;
  await stageFile(page, cases[0]);

  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await expect(page.getByRole("status")).toHaveText(
    "Review canceled. No transactions were imported.",
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

test("an unsupported file fails locally before any origin is uploaded", async ({ page }) => {
  await page.goto(`/vibes/${VIBE_ID}`);

  await page.getByLabel("Transaction export file").setInputFiles({
    name: "transactions.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not a supported transaction export"),
  });

  await expect(page.getByRole("alert")).toHaveText(
    "Choose a .csv, .qfx, or .ofx transaction export.",
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
