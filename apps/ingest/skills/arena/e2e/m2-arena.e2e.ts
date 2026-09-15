import { expect, test } from "../../../../host/e2e/support/playwright.ts";

import {
  NEW_VIBE_ID,
  VIBE_ID,
  installMockStore,
  type MockStore,
} from "../../../../host/e2e/support/mockStore.ts";
import {
  ARENA_CHANNEL_URL,
  ARENA_IMPORT_OPERATION_ID,
  ARENA_IMPORT_SOURCE_ID,
  mockArenaSourceSkill,
} from "./support/mockArenaSkill.ts";

const CHANNEL_URL = ARENA_CHANNEL_URL;
const BOARD_TITLES = [
  "A small manifesto",
  "One synthetic pixel",
  "A safe example destination",
  "Synthetic field notes",
  "Inert synthetic embed",
] as const;

let mockStore: MockStore;

test.beforeEach(async ({ page }) => {
  mockStore = await installMockStore(page, { sourceSkills: [mockArenaSourceSkill] });
  const target = mockStore.vibes[0];
  if (!target) throw new Error("Missing mocked target Vibe");
  delete target.pull;
});

test("a new Vibe uses the Are.na board title without entering a name", async ({ page }) => {
  await page.goto("/imports");
  await page.getByLabel("Import source", { exact: true }).selectOption({ label: "Are.na channel" });
  await page.getByLabel("Are.na channel URL").fill(CHANNEL_URL);
  await page.getByRole("button", { name: "Review Are.na channel" }).click();

  await expect(page.getByLabel("VERIFY reconciliation")).toBeVisible();
  await expect(page.getByLabel("New Vibe title")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Confirm import" })).toBeEnabled();
  expect(mockStore.vibes.some(({ uri }) => uri.endsWith(`/${NEW_VIBE_ID}`))).toBe(false);

  await page.getByRole("button", { name: "Confirm import" }).click();

  await expect(page).toHaveURL(new RegExp(`/vibes/${NEW_VIBE_ID}\\?mode=maximized$`));
  await expect(
    page.getByRole("heading", { name: "Synthetic Media Study", exact: true, level: 1 }),
  ).toBeVisible();
  const created = mockStore.vibes.find(({ uri }) => uri.endsWith(`/${NEW_VIBE_ID}`));
  expect(created?.title).toBe("Synthetic Media Study");
  expect(created?.objects).toHaveLength(5);
  const confirmation = mockStore.requests.find(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === `/rnet/v0/imports/${ARENA_IMPORT_OPERATION_ID}/confirm`,
  );
  expect(confirmation?.postDataJSON()).toEqual({ title: "Synthetic Media Study" });
});

test("a public Are.na channel follows element-aware review and commits atomically", async ({
  page,
}) => {
  const initialMembership = [...(mockStore.vibes[0]?.objects ?? [])];
  const initialObjectCount = mockStore.objects.size;
  const initialElementCount = mockStore.elements.size;

  await page.goto(`/vibes/${VIBE_ID}`);
  await page.getByRole("button", { name: "Import into this Vibe", exact: true }).click();
  await page.getByLabel("Import source", { exact: true }).selectOption({ label: "Are.na channel" });
  await page.getByLabel("Are.na channel URL").fill(CHANNEL_URL);
  await page.getByRole("button", { name: "Review Are.na channel" }).click();

  const reconciliation = page.getByLabel("VERIFY reconciliation");
  await expect(reconciliation).toBeVisible();
  await expect(reconciliation).toContainText("5 objects passed VERIFY");
  await expect(reconciliation).toContainText("5 source records → 5 candidates");
  await expect(reconciliation).toContainText("9 elements staged");
  await expect(page.getByLabel("New Vibe title")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "VERIFY checks" }).getByRole("listitem")).toHaveCount(
    8,
  );

  const candidates = page.getByRole("list", { name: "Candidate media objects" });
  const candidateRows = candidates.locator("[data-import-candidate]");
  await expect(candidateRows).toHaveCount(5);
  await expect(candidateRows).toContainText([...BOARD_TITLES]);
  await expect(candidates.locator("[data-import-candidate] img")).toHaveCount(2);
  await expect(candidates).toContainText("A small manifesto");
  await expect(candidates).toContainText("Inert synthetic embed");
  await expect(candidates).toContainText("Synthetic field notes");
  await expect(candidates).toContainText("arena.block · 2 elements");
  await expect(candidates).toContainText("arena.block · 1 element");
  await expect(candidates).toContainText("text/plain");
  await expect(candidates).toContainText("text/markdown");
  await expect(candidates).toContainText("image/png");
  await expect(candidates).toContainText("application/pdf");
  await expect(page.getByText("Are.na channel", { exact: true }).last()).toBeVisible();
  const previewRequests = mockStore.requests.filter(
    (request) =>
      request.method() === "GET" &&
      /\/rnet\/v0\/operations\/[^/]+\/elements\/[^/]+\/bytes$/.test(
        new URL(request.url()).pathname,
      ),
  );
  expect(previewRequests).toHaveLength(5);
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
    skill_id: "arena",
    connector_version: "arena-connector@1.0.0",
    parser: "arena",
    config: { url: CHANNEL_URL },
  });

  const posts = mockStore.requests.filter((request) => request.method() === "POST");
  expect(posts.map((request) => new URL(request.url()).pathname)).toEqual([
    "/rnet/v0/ingestion-sources",
    `/rnet/v0/vibes/${VIBE_ID}/imports`,
  ]);
  expect(posts[0]?.postDataJSON()).toEqual({
    skill_id: "arena",
    config: { url: CHANNEL_URL },
  });

  await page.getByRole("button", { name: "Confirm import" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Imported" })).toContainText(
    "Imported 5 objects from Are.na channel.",
  );
  await expect(page.getByLabel("VERIFY reconciliation")).toHaveCount(0);
  const importedCards = page.locator("[data-media-object-card]");
  await expect(importedCards).toHaveCount(6);
  for (const title of BOARD_TITLES) {
    const card = importedCards.filter({ hasText: title });
    await expect(card).toHaveCount(1);
    await expect(card.getByRole("button", { name: /^Remove rnet:\/\/object\// })).toHaveCount(0);
  }
  await expect(page.getByText("6 objects", { exact: true })).toBeVisible();
  const markdownPreview = page.getByTitle("Markdown content for A small manifesto");
  await expect(markdownPreview).toBeVisible();
  await expect(markdownPreview).toHaveCSS("color-scheme", "light");
  await expect(page.getByRole("img", { name: "Synthetic primary" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Synthetic link-preview" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Open source for/ })).toHaveCount(0);
  await expect(page.getByTitle("PDF preview for Synthetic field notes")).toBeVisible();
  await expect(page.getByText("Loading image…")).toHaveCount(0);
  expect(mockStore.vibes[0]?.objects).toHaveLength(initialMembership.length + 5);
  expect(mockStore.objects.size).toBe(initialObjectCount + 5);
  expect(mockStore.elements.size).toBe(initialElementCount + 9);
  const importedObjects = [...mockStore.objects.values()].filter(
    (object) => object.type === "arena.block",
  );
  for (const object of importedObjects) {
    const titleUri = object.elements[0]?.uri;
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

test("a non-Are.na URL fails before a remote source is captured or created", async ({ page }) => {
  await page.goto(`/vibes/${VIBE_ID}`);
  await page.getByRole("button", { name: "Import into this Vibe", exact: true }).click();
  await page.getByLabel("Import source", { exact: true }).selectOption({ label: "Are.na channel" });
  await page.getByLabel("Are.na channel URL").fill("https://example.com/not-an-arena/channel");
  await page.getByRole("button", { name: "Review Are.na channel" }).click();

  await expect(page.getByRole("alert")).toHaveText("Enter a public Are.na channel URL");
  expect(mockStore.ingestionSources.size).toBe(0);
  expect(mockStore.origins.size).toBe(0);
  const posts = mockStore.requests.filter((request) => request.method() === "POST");
  expect(posts.map((request) => new URL(request.url()).pathname)).toEqual([
    "/rnet/v0/ingestion-sources",
  ]);
});
