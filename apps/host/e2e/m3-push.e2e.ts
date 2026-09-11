import { storeTaskKey } from "@rhizome/store-contract";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PUSH_TASKS } from "../src/api/generated/push-tasks.ts";

import {
  ELEMENT_ID,
  installMockStore,
  OBJECT_ID,
  VIBE_ID,
  type MockStore,
} from "./support/mockStore.ts";

let store: MockStore;
test.beforeEach(async ({ page }) => {
  store = await installMockStore(page);
});

test("object and Vibe pushes poll, refresh inferred data, and render the inferred view", async ({
  page,
}) => {
  await page.goto(`/vibes/${VIBE_ID}`);
  await expect(page.getByText("Monthly plan", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Open object rnet://object/${OBJECT_ID}` }).click();
  await expect(page.getByLabel("User properties, as JSON")).toBeVisible();
  const objectReadsBefore = store.requests.filter(
    (request) =>
      request.method() === "GET" &&
      new URL(request.url()).pathname === `/rnet/v0/objects/${OBJECT_ID}`,
  ).length;
  await page.getByRole("button", { name: "Back" }).click();

  await page.getByLabel("Push task").selectOption(`object:${PUSH_TASKS.object.display_name.name}`);
  await page.getByRole("button", { name: "Run on missing" }).click();
  await expect(page.getByText("Push done", { exact: true })).toBeVisible();
  await expect(page.getByText("Enriched monthly plan", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run on missing" })).toBeDisabled();
  const firstPush = store.requests.find((request) =>
    new URL(request.url()).pathname.endsWith("/push"),
  );
  expect(firstPush?.postDataJSON()).toEqual({
    level: "object",
    task: PUSH_TASKS.object.display_name.name,
    selection: [`rnet://object/${OBJECT_ID}`],
  });

  await page.getByRole("button", { name: "Rerun all" }).click();
  await expect(page.getByRole("button", { name: "Rerun all" })).toBeDisabled();
  await expect
    .poll(
      () =>
        store.requests.filter((request) => new URL(request.url()).pathname.endsWith("/push"))
          .length,
    )
    .toBe(2);
  const rerun = store.requests
    .filter((request) => new URL(request.url()).pathname.endsWith("/push"))
    .at(-1);
  expect(rerun?.postDataJSON()).toEqual({
    level: "object",
    task: PUSH_TASKS.object.display_name.name,
  });
  await expect(page.getByRole("button", { name: "Rerun all" })).toBeEnabled();

  await page.getByRole("button", { name: `Open object rnet://object/${OBJECT_ID}` }).click();
  await expect(
    page.locator("pre").filter({ hasText: storeTaskKey(PUSH_TASKS.object.display_name.name) }),
  ).toContainText("Enriched monthly plan");
  await expect
    .poll(
      () =>
        store.requests.filter(
          (request) =>
            request.method() === "GET" &&
            new URL(request.url()).pathname === `/rnet/v0/objects/${OBJECT_ID}`,
        ).length,
    )
    .toBeGreaterThan(objectReadsBefore);
  await page.getByRole("button", { name: "Back" }).click();

  await page.getByLabel("Push task").selectOption(`vibe:${PUSH_TASKS.vibe.vibe_view.name}`);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByLabel("Inferred Vibe view")).toHaveAttribute(
    "data-vibe-view",
    "simplelist",
  );
  await expect(
    page.getByLabel("Inferred Vibe view").getByText("Monthly plan", { exact: true }),
  ).toBeVisible();

  await page.getByLabel("Push task").selectOption(`vibe:${PUSH_TASKS.vibe.summarize.name}`);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
  await expect(page.getByText("A focused collection of monthly planning notes.")).toBeVisible();
});

test("describe_media offers rerun all and refreshes a cached element's inferred data", async ({
  page,
}) => {
  const imageId = "0198f2a1-c2ad-78cc-b7fa-1e7d77d63bf4";
  const original = store.elements.get(imageId)!;
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT3cAAAAASUVORK5CYII=",
    "base64",
  );
  store.elements.set(imageId, {
    ...original,
    kind: "image",
    mime: "image/png",
    byte_size: bytes.length,
    content_hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  });
  store.elementPayloads.set(imageId, bytes);
  await page.goto(`/vibes/${VIBE_ID}`);
  await page.getByRole("button", { name: `Open object rnet://object/${OBJECT_ID}` }).click();
  await expect(page.getByRole("img", { name: original.alt })).toBeVisible();
  const reads = () =>
    store.requests.filter(
      (request) =>
        request.method() === "GET" &&
        new URL(request.url()).pathname === `/rnet/v0/elements/${imageId}`,
    ).length;
  const before = reads();
  expect(before).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Back" }).click();
  await page
    .getByLabel("Push task")
    .selectOption(`element:${PUSH_TASKS.element.describe_media.name}`);
  await expect(page.getByRole("button", { name: "Run on missing" })).toHaveCount(0);
  const refreshed = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === `/rnet/v0/elements/${imageId}`,
  );
  await page.getByRole("button", { name: "Rerun all" }).click();
  await expect(page.getByText("Push done", { exact: true })).toBeVisible();
  const sent = store.requests
    .filter((request) => new URL(request.url()).pathname.endsWith("/push"))
    .at(-1)!;
  expect(sent.postDataJSON()).toEqual({
    level: "element",
    task: PUSH_TASKS.element.describe_media.name,
  });
  await page.getByRole("button", { name: `Open object rnet://object/${OBJECT_ID}` }).click();
  const document = await (await refreshed).json();
  expect(
    document.inferred[storeTaskKey(PUSH_TASKS.element.describe_media.name)].properties,
  ).toEqual({
    caption: "A small monochrome image",
    description: "A single light pixel fills a square frame.",
    medium: "other",
    subjects: [],
    text_in_image: null,
  });
  expect(reads()).toBeGreaterThan(before);
  await expect(page.getByRole("img", { name: original.alt })).toBeVisible();
});

test("mediaboard shows an uncropped M2 card and fetches only its primary payload", async ({
  page,
}) => {
  const original = store.elements.get(ELEMENT_ID)!;
  const imageIds = ["0198f2a1-c2ad-78cc-b7fa-1e7d77d63bf5", "0198f2a1-c2ad-78cc-b7fa-1e7d77d63bf6"];
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT3cAAAAASUVORK5CYII=",
    "base64",
  );
  const record = store.objects.get(OBJECT_ID)!;
  record.elements[0]!.role = "title";
  for (const [index, id] of imageIds.entries()) {
    const uri = `rnet://element/${id}` as const;
    store.elements.set(id, {
      ...original,
      uri,
      kind: "image",
      mime: "image/png",
      alt: `Board image ${index + 1}`,
      byte_size: bytes.length,
      content_hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    });
    store.elementPayloads.set(id, bytes);
    record.elements.push({ uri, role: "content" });
  }
  record.inferred = {
    [storeTaskKey(PUSH_TASKS.object.display_name.name)]: {
      model: "mock/rhizome",
      properties: { display_name: "An inferred board title" },
    },
  };
  store.vibes[0]!.inferred = {
    [storeTaskKey(PUSH_TASKS.vibe.vibe_view.name)]: {
      model: "rhizome/vibe_view-rules@1",
      properties: {
        view: "mediaboard",
        config: { caption_pointer: "/source/properties/title" },
      },
    },
  };

  await page.goto(`/vibes/${VIBE_ID}`);
  const board = page.getByLabel("Inferred Vibe view");
  const card = board.locator("[data-media-object-card]");
  await expect(card).toHaveCount(1);
  const image = card.getByRole("img", { name: "Board image 1" });
  await expect(image).toBeVisible();
  await expect(image).toHaveCSS("object-fit", "contain");
  await expect
    .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
    .toBe(1);
  await expect(card.getByText("An inferred board title", { exact: true })).toBeVisible();
  await expect(card.getByText("Monthly plan", { exact: true })).toBeVisible();
  await expect(card).toContainText("image/png · 3 elements");
  expect(
    store.requests
      .map((request) => new URL(request.url()).pathname)
      .filter((path) => /^\/rnet\/v0\/elements\/[^/]+\/bytes$/.test(path)),
  ).toEqual([`/rnet/v0/elements/${imageIds[0]}/bytes`]);
  await card.getByRole("button", { name: `Open object rnet://object/${OBJECT_ID}` }).click();
  await expect(page.getByLabel("User properties, as JSON")).toBeVisible();
});

test("datatable rows open objects from values and title links without intercepting row actions", async ({
  page,
}) => {
  store.vibes[0]!.inferred = {
    [storeTaskKey(PUSH_TASKS.vibe.vibe_view.name)]: {
      model: "mock/rhizome",
      properties: {
        view: "datatable",
        config: { columns: ["/source/properties/title"], sort: null },
      },
    },
  };
  await page.goto(`/vibes/${VIBE_ID}`);
  const board = page.getByLabel("Inferred Vibe view");
  const objectLink = board.getByRole("link");
  await expect(objectLink).toHaveAttribute("href", `/objects/${OBJECT_ID}`);

  await board.getByRole("cell", { name: "Monthly plan", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/objects/${OBJECT_ID}$`));
  await expect(page.getByLabel("User properties, as JSON")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(board).toBeVisible();

  await objectLink.focus();
  await objectLink.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/objects/${OBJECT_ID}$`));
  await page.getByRole("button", { name: "Back" }).click();
  await board.getByRole("button", { name: `Open object rnet://object/${OBJECT_ID}` }).click();
  await expect(page).toHaveURL(new RegExp(`/objects/${OBJECT_ID}$`));
  await page.getByRole("button", { name: "Back" }).click();

  await board.getByRole("button", { name: `Remove rnet://object/${OBJECT_ID} from Vibe` }).click();
  await expect(page.getByText("This Vibe has no objects yet.")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/vibes/${VIBE_ID}$`));
});
