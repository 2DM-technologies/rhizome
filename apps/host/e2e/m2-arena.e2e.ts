import { expect, test } from "@playwright/test";

import {
  ARENA_IMPORT_SOURCE_ID,
  VIBE_ID,
  installMockStore,
  type MockStore,
} from "./support/mockStore.ts";

const CHANNEL_URL = "https://www.are.na/noah-putnam/love-always-wins";
const BOARD_TITLES = [
  "Planning notes",
  "Manifesto",
  "A saved link with a preview",
  "A still image",
  "A saved link without a preview",
] as const;

let mockStore: MockStore;

test.beforeEach(async ({ page }) => {
  mockStore = await installMockStore(page);
  const target = mockStore.vibes[0];
  if (!target) throw new Error("Missing mocked target Vibe");
  delete target.pull;
});

test("a public Are.na channel follows element-aware review and commits atomically", async ({
  page,
}) => {
  const initialMembership = [...(mockStore.vibes[0]?.objects ?? [])];
  const initialObjectCount = mockStore.objects.size;
  const initialElementCount = mockStore.elements.size;

  await page.goto(`/vibes/${VIBE_ID}`);
  await page.getByLabel("Are.na channel URL").fill(CHANNEL_URL);
  await page.getByRole("button", { name: "Review channel" }).click();

  const reconciliation = page.getByLabel("VERIFY reconciliation");
  await expect(reconciliation).toBeVisible();
  await expect(reconciliation).toContainText("5 Are.na blocks passed VERIFY");
  await expect(reconciliation).toContainText("5 source blocks → 5 candidates");
  await expect(reconciliation).toContainText("9 media elements staged");
  await expect(page.getByRole("list", { name: "VERIFY checks" }).getByRole("listitem")).toHaveCount(
    8,
  );

  const candidates = page.getByRole("list", { name: "Candidate Are.na blocks" });
  const candidateRows = candidates.locator("[data-import-candidate]");
  await expect(candidateRows).toHaveCount(5);
  await expect(candidateRows).toContainText([...BOARD_TITLES]);
  await expect(candidates.locator("[data-import-candidate] img")).toHaveCount(2);
  await expect(candidates).toContainText("Manifesto");
  await expect(candidates).toContainText("A saved link without a preview");
  await expect(candidates).toContainText("Planning notes");
  await expect(candidates).toContainText("arena.block · 2 elements");
  await expect(candidates).toContainText("arena.block · 1 element");
  await expect(candidates).toContainText("text/plain");
  await expect(candidates).toContainText("text/markdown");
  await expect(candidates).toContainText("image/png");
  await expect(candidates).toContainText("application/pdf");
  await expect(page.getByText("Are.na / love-always-wins", { exact: true })).toBeVisible();
  const previewRequests = mockStore.requests.filter(
    (request) =>
      request.method() === "GET" &&
      /\/rnet\/v0\/operations\/[^/]+\/elements\/[^/]+\/bytes$/.test(
        new URL(request.url()).pathname,
      ),
  );
  expect(previewRequests).toHaveLength(2);
  expect(
    previewRequests.every((request) => request.headers()["authorization"]?.startsWith("Bearer ")),
  ).toBe(true);

  expect(mockStore.vibes[0]?.objects).toEqual(initialMembership);
  expect(mockStore.objects.size).toBe(initialObjectCount);
  expect(mockStore.elements.size).toBe(initialElementCount);
  expect(mockStore.origins.size).toBe(1);
  expect(mockStore.ingestionSources.size).toBe(1);
  const [source] = [...mockStore.ingestionSources.values()];
  expect(source).toMatchObject({
    source: `source:${ARENA_IMPORT_SOURCE_ID}`,
    kind: "remote",
    provider: "arena",
    parser: "arena",
    config: { channel_slug: "love-always-wins" },
  });

  const posts = mockStore.requests.filter((request) => request.method() === "POST");
  expect(posts.map((request) => new URL(request.url()).pathname)).toEqual([
    "/rnet/v0/ingestion-sources",
    `/rnet/v0/vibes/${VIBE_ID}/imports`,
  ]);
  expect(posts[0]?.postDataJSON()).toEqual({ provider: "arena", channel_url: CHANNEL_URL });

  await page.getByRole("button", { name: "Confirm import" }).click();

  await expect(page.getByRole("status")).toContainText(
    "Imported 5 Are.na blocks from Are.na / love-always-wins.",
  );
  await expect(page.getByLabel("VERIFY reconciliation")).toHaveCount(0);
  const importedCards = page.getByRole("button", { name: /^Open Are.na block/ });
  await expect(importedCards).toHaveCount(5);
  for (const [index, title] of BOARD_TITLES.entries()) {
    await expect(importedCards.nth(index)).toHaveAccessibleName(`Open Are.na block ${title}`);
  }
  await expect(page.getByText("5 blocks", { exact: true })).toBeVisible();
  const markdownPreview = page.getByTitle("Markdown content for Manifesto");
  await expect(markdownPreview).toBeVisible();
  await expect(markdownPreview).toHaveCSS("color-scheme", "light");
  await expect(page.getByRole("img", { name: "A still image" })).toBeVisible();
  await expect(page.getByRole("img", { name: "A saved link with a preview" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open source for A saved link without a preview" }),
  ).toHaveAttribute("href", "https://example.com/no-preview");
  await expect(page.getByTitle("PDF preview for Planning notes")).toBeVisible();
  await expect(page.getByText("Loading image…")).toHaveCount(0);
  expect(mockStore.vibes[0]?.objects).toHaveLength(initialMembership.length + 5);
  expect(mockStore.objects.size).toBe(initialObjectCount + 5);
  expect(mockStore.elements.size).toBe(initialElementCount + 9);
  const importedObjects = [...mockStore.objects.values()].filter(
    (object) => object.type === "arena.block",
  );
  for (const object of importedObjects) {
    const titleUri = object.elements[0];
    const titleElementId = titleUri?.split("/").at(-1) ?? "";
    expect(mockStore.elements.get(titleElementId)).toMatchObject({
      kind: "text",
      mime: "text/plain",
    });
    expect(mockStore.elementPayloads.get(titleElementId)?.toString("utf8")).toBe(
      object.source.properties.title,
    );
  }
  expect(mockStore.vibes[0]?.pull?.sources).toContain(`source:${ARENA_IMPORT_SOURCE_ID}`);
});

test("a non-Are.na URL fails locally before a remote source is created", async ({ page }) => {
  await page.goto(`/vibes/${VIBE_ID}`);
  await page.getByLabel("Are.na channel URL").fill("https://example.com/not-an-arena/channel");
  await page.getByRole("button", { name: "Review channel" }).click();

  await expect(page.getByRole("alert")).toHaveText(
    "Paste a public Are.na channel URL, like https://www.are.na/owner/channel.",
  );
  expect(mockStore.ingestionSources.size).toBe(0);
  expect(mockStore.origins.size).toBe(0);
  expect(mockStore.requests.filter((request) => request.method() === "POST")).toHaveLength(0);
});
