import type { SourceSkillManifest } from "@rhizome/store-contract";

import { expect, type Page } from "./playwright.ts";
import {
  VIBE_ID,
  installMockStore,
  type MockSourceSkillAdapter,
  type MockStore,
} from "./mockStore.ts";

export interface ReviewedFileSkillConformanceCase {
  adapter: MockSourceSkillAdapter;
  candidateCount: number;
  fixtureFilename: string;
  fixturePath: string;
  total: string;
  verifyCheckCount: number;
}

/**
 * Builds provider-neutral reviewed-file behavior while leaving the named Playwright cases beside
 * each skill's adapter and fixtures.
 */
export function createReviewedFileSkillConformance({
  adapter,
  candidateCount,
  fixtureFilename,
  fixturePath,
  total,
  verifyCheckCount,
}: ReviewedFileSkillConformanceCase) {
  const fileField = fileInput(adapter.manifest);

  async function install(page: Page): Promise<MockStore> {
    const mockStore = await installMockStore(page, { sourceSkills: [adapter] });
    const target = mockStore.vibes[0];
    if (!target) throw new Error("Missing mocked target Vibe");
    delete target.pull;
    return mockStore;
  }

  async function stageFixture(page: Page): Promise<void> {
    await page.goto(`/vibes/${VIBE_ID}`);
    await page.getByRole("button", { name: "Import into this Vibe", exact: true }).click();
    await page
      .getByLabel("Import source", { exact: true })
      .selectOption({ label: adapter.manifest.label });
    await page.getByLabel(fileField.label, { exact: true }).setInputFiles(fixturePath);
    await page
      .getByRole("button", { name: `Review ${adapter.manifest.label}`, exact: true })
      .click();

    const reconciliation = page.getByLabel("VERIFY reconciliation");
    await expect(reconciliation).toBeVisible();
    await expect(reconciliation).toContainText(`${candidateCount} transactions passed VERIFY`);
    await expect(reconciliation).toContainText(
      `${candidateCount} source records → ${candidateCount} candidates`,
    );
    await expect(reconciliation).toContainText(total);
    await expect(
      page.getByRole("list", { name: "VERIFY checks" }).getByRole("listitem"),
    ).toHaveCount(verifyCheckCount);
    await expect(
      page
        .getByRole("list", { name: "Candidate media objects" })
        .locator("[data-import-candidate]"),
    ).toHaveCount(candidateCount);
    await expect(page.getByText(fixtureFilename, { exact: true })).toBeVisible();
  }

  return {
    install,
    async confirm(page: Page, mockStore: MockStore): Promise<void> {
      const initialMembership = [...(mockStore.vibes[0]?.objects ?? [])];
      const initialObjectCount = mockStore.objects.size;

      await stageFixture(page);

      expect(mockStore.vibes[0]?.objects).toEqual(initialMembership);
      expect(mockStore.objects.size).toBe(initialObjectCount);
      expect(mockStore.origins.size).toBe(1);
      expect(mockStore.ingestionSources.size).toBe(1);
      const [origin] = [...mockStore.origins.values()];
      const [source] = [...mockStore.ingestionSources.values()];
      expect(origin?.document.label).toBe(fixtureFilename);
      expect(origin?.byteLength).toBeGreaterThan(0);
      expect(source?.parser).toBe(adapter.manifest.parser.name);
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
        `Imported ${candidateCount} transactions from ${fixtureFilename}.`,
      );
      await expect(page.getByLabel("VERIFY reconciliation")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Open object rnet:/ })).toHaveCount(
        initialMembership.length + candidateCount,
      );
      await expect(page.getByRole("button", { name: "Refresh sources" })).toBeVisible();
      expect(mockStore.vibes[0]?.objects).toHaveLength(initialMembership.length + candidateCount);
      expect(mockStore.objects.size).toBe(initialObjectCount + candidateCount);
      expect(mockStore.vibes[0]?.pull?.sources).toContain(source?.source);
      expect(
        mockStore.requests.filter(
          (request) =>
            request.method() === "POST" && new URL(request.url()).pathname.endsWith("/confirm"),
        ),
      ).toHaveLength(1);
    },
    async cancel(page: Page, mockStore: MockStore): Promise<void> {
      const initialMembership = [...(mockStore.vibes[0]?.objects ?? [])];
      const initialObjectCount = mockStore.objects.size;
      await stageFixture(page);

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
    },
    async rejectUnsupportedFile(page: Page, mockStore: MockStore): Promise<void> {
      await page.goto(`/vibes/${VIBE_ID}`);
      await page.getByRole("button", { name: "Import into this Vibe", exact: true }).click();
      await page
        .getByLabel("Import source", { exact: true })
        .selectOption({ label: adapter.manifest.label });
      await page.getByLabel(fileField.label, { exact: true }).setInputFiles({
        name: "transactions.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("not a supported transaction export"),
      });
      await page
        .getByRole("button", { name: `Review ${adapter.manifest.label}`, exact: true })
        .click();

      await expect(page.getByRole("alert")).toHaveText(
        `Choose a file accepted by ${adapter.manifest.label}.`,
      );
      expect(mockStore.origins.size).toBe(0);
      expect(mockStore.ingestionSources.size).toBe(0);
      expect(
        mockStore.requests.filter(
          (request) =>
            request.method() === "POST" && new URL(request.url()).pathname === "/rnet/v0/origins",
        ),
      ).toHaveLength(0);
    },
  };
}

function fileInput(manifest: SourceSkillManifest) {
  const field = manifest.input_fields.find((candidate) => candidate.control === "file");
  if (!field) throw new Error(`${manifest.skill_id} does not declare a file input`);
  return field;
}
