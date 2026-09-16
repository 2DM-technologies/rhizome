import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { MediaElement, MediaObject } from "@rnet/types";
import { expect, test } from "@playwright/test";
import {
  ELEMENT_ID,
  OBJECT_ID,
  VIBE_ID,
  installMockStore,
  type MockStore,
} from "./support/mockStore.ts";

const uuid = (index: number) => `0198f2a1-7c3d-7e4b-9f21-${String(index).padStart(12, "0")}`;
const bodyText =
  "Learning to notice the small things. 🌱\n\nA field note: https://short.example/notes\nLiteral <script>text</script>, not markup.";
let store: MockStore;

function element(
  index: number,
  kind: MediaElement["kind"],
  mime: string,
  bytes: Buffer,
  alt?: string,
) {
  const id = uuid(index);
  const record: MediaElement = {
    ...store.elements.get(ELEMENT_ID)!,
    uri: `rnet://element/${id}`,
    kind,
    mime,
    alt,
    bytes: `https://store.example/rnet/v0/elements/${id}/bytes`,
    byte_size: bytes.length,
    content_hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  };
  store.elements.set(id, record);
  store.elementPayloads.set(id, bytes);
  return { uri: record.uri, role: "content" as const };
}

function tweet(index: number, text: string, published_at: string): MediaObject {
  const record: MediaObject = {
    ...store.objects.get(OBJECT_ID)!,
    uri: `rnet://object/${uuid(index)}`,
    type: "tweet",
    source: {
      ingest: { method: "parser", skill: "test@1", reproducible: true },
      origins: [],
      properties: {
        author_name: index === 1 ? "Maya Chen" : "Eli Park",
        author_handle: index === 1 ? "mayachen" : "elipark",
        published_at,
        post_kind: "original",
        entities: {
          urls: [
            {
              url: "https://short.example/notes",
              expanded_url: "https://example.test/field-notes",
            },
          ],
        },
      },
    },
    keys: { canonical_url: `https://social.example/posts/${index}` },
    inferred: {},
    elements: [element(100 + index, "text", "text/plain", Buffer.from(text))],
  };
  store.objects.set(uuid(index), record);
  return record;
}

test.beforeEach(async ({ page }) => {
  store = await installMockStore(page);
  const older = tweet(1, bodyText, "2026-09-10T12:00:00Z");
  const newer = tweet(2, "A little motion study.\nSomething to return to.", "2026-09-11T12:00:00Z");
  newer.source.properties.post_kind = "quote";
  newer.keys!.x_quoted_tweet_url = "https://social.example/posts/quoted";
  newer.elements.push(
    element(
      201,
      "video",
      "video/webm",
      await readFile(new URL("./fixtures/tweetfeed.webm", import.meta.url)),
      "Motion study",
    ),
  );
  older.elements.push(
    element(
      202,
      "image",
      "image/jpeg",
      await readFile(new URL("../src/assets/brand/wallpaper.jpg", import.meta.url)),
      "Field notes",
    ),
  );
  older.elements.push(
    element(203, "image", "image/jpeg", store.elementPayloads.get(uuid(202))!, "Another page"),
  );
  store.vibes[0]!.title = "Notes from the timeline";
  store.vibes[0]!.objects = [older.uri, newer.uri];
  store.vibes[0]!.inferred = {};
});

for (const width of [1280, 390]) {
  test(`tweetfeed displays complete posts and playable attachments at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/vibes/${VIBE_ID}`);
    const feed = page.getByRole("list", { name: "Tweet feed" });
    const rows = feed.locator("[data-tweet-object]");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toHaveAttribute("data-tweet-object", `rnet://object/${uuid(2)}`);
    await expect(feed.getByText("@mayachen", { exact: true })).toBeVisible();
    await expect(rows.first().locator("time")).toHaveAttribute(
      "datetime",
      "2026-09-11T12:00:00.000Z",
    );
    await rows.last().scrollIntoViewIfNeeded();
    const body = rows.last().locator("[data-tweet-text]");
    await expect(body).toHaveText(bodyText);
    expect(await body.textContent()).toBe(bodyText);
    await expect(body).toHaveCSS("white-space", "pre-wrap");
    await expect(body.locator("script")).toHaveCount(0);
    await expect(body.getByRole("link")).toHaveAttribute(
      "href",
      "https://example.test/field-notes",
    );
    await expect(rows.first().getByRole("link", { name: "View quoted post" })).toHaveAttribute(
      "href",
      "https://social.example/posts/quoted",
    );
    await expect(rows.first().getByRole("link", { name: "Original post" })).toHaveAttribute(
      "href",
      "https://social.example/posts/2",
    );
    const video = feed.locator("video");
    await expect(video).toHaveAttribute("controls", "");
    expect(await video.evaluate((node) => (node as HTMLVideoElement).autoplay)).toBe(false);
    await video.scrollIntoViewIfNeeded();
    await video.evaluate((node) => (node as HTMLVideoElement).play());
    await expect
      .poll(() => video.evaluate((node) => (node as HTMLVideoElement).currentTime))
      .toBeGreaterThan(0);
    await video.evaluate((node) => (node as HTMLVideoElement).pause());
    const image = feed.getByRole("img", { name: "Field notes" });
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await expect(image).toHaveCSS("object-fit", "contain");
    await expect(feed.getByRole("img", { name: "Another page" })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const payloads = store.requests.filter((request) =>
      /\/elements\/[^/]+\/bytes$/.test(new URL(request.url()).pathname),
    );
    expect(payloads).toHaveLength(5);
    expect(
      payloads.every((request) => request.headers().authorization?.startsWith("Bearer ")),
    ).toBe(true);
    await page
      .getByRole("heading", { name: "Notes from the timeline", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("tweetfeed.png"), fullPage: true });
    const open = rows.first().getByRole("link", { name: `Open object rnet://object/${uuid(2)}` });
    await expect(open).toHaveAttribute("href", `/objects/${uuid(2)}`);
    await open.focus();
    await open.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/objects/${uuid(2)}\\?mode=maximized$`));
    await expect(page.getByLabel("User properties, as JSON")).toBeVisible();
  });
}

test("missing payloads stay local to the post; links retain native modified-click behavior", async ({
  page,
}) => {
  await page.route(`**/rnet/v0/elements/${uuid(101)}/bytes`, (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "about:blank",
        title: "Not found",
        status: 404,
        code: "not_found",
        detail: "Payload unavailable",
      }),
    }),
  );
  await page.goto(`/vibes/${VIBE_ID}`);
  const feed = page.getByRole("list", { name: "Tweet feed" });
  const failed = feed.locator("[data-tweet-object]").last();
  await failed.scrollIntoViewIfNeeded();
  await expect(failed.getByText("Post text unavailable", { exact: true })).toBeVisible();
  await expect(failed.getByRole("img", { name: "Field notes" })).toBeVisible();
  const open = failed.getByRole("link", { name: `Open object rnet://object/${uuid(1)}` });
  expect(
    await open.evaluate((node) => {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
      // Observe whether React cancelled the modifier click, then suppress native navigation in the test.
      let prevented = false;
      const listener = (click: MouseEvent) => {
        prevented = click.defaultPrevented;
        click.preventDefault();
      };
      document.addEventListener("click", listener, { once: true });
      node.dispatchEvent(event);
      return prevented;
    }),
  ).toBe(false);
  await expect(page).toHaveURL(new RegExp(`/vibes/${VIBE_ID}$`));
});

test("a mixed collection keeps its inferred view and offscreen posts defer payload downloads", async ({
  page,
}) => {
  store.vibes[0]!.objects.push(`rnet://object/${OBJECT_ID}`);
  store.vibes[0]!.inferred = {
    "rhizome:vibe-view": {
      model: "mock/rhizome",
      properties: { view: "simplelist", config: { subtitle_pointer: null } },
    },
  };
  await page.goto(`/vibes/${VIBE_ID}`);
  await expect(page.locator('[data-vibe-view="simplelist"]')).toBeVisible();
  await expect(page.getByRole("list", { name: "Tweet feed" })).toHaveCount(0);

  const objects = Array.from({ length: 25 }, (_, index) =>
    tweet(index + 3, `Post ${index + 3}\n\nA longer note for the feed.`, "2026-09-10T12:00:00Z"),
  );
  store.vibes[0]!.objects = objects.map(({ uri }) => uri);
  store.vibes[0]!.inferred = {};
  await page.reload();
  const feed = page.getByRole("list", { name: "Tweet feed" });
  await expect(feed.locator("[data-tweet-object]")).toHaveCount(25);
  await expect(feed.locator("[data-tweet-text]").first()).toContainText("Post 3");
  const lastPath = `/rnet/v0/elements/${uuid(127)}/bytes`;
  const reads = () =>
    store.requests.filter((request) => new URL(request.url()).pathname === lastPath);
  expect(reads()).toHaveLength(0);
  await feed.locator("[data-tweet-object]").last().scrollIntoViewIfNeeded();
  await expect(feed.locator("[data-tweet-text]").last()).toContainText("Post 27");
  expect(reads()).toHaveLength(1);
});

test("action tooltips escape clipped rows, use the requested colors, and support keyboard focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/vibes/${VIBE_ID}`);
  const row = page.getByRole("list", { name: "Tweet feed" }).locator("[data-tweet-object]").first();
  const objectLink = row.getByRole("link", { name: /^Open object/ });
  const originalLink = row.getByRole("link", { name: "Original post", exact: true });
  // A containing row can clip its contents without clipping these overlays.
  await row.evaluate((element) => {
    element.style.overflow = "hidden";
  });
  await objectLink.hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toHaveText("Open object");
  await expect(tooltip).toHaveCSS("background-color", "rgb(37, 37, 37)");
  await expect(tooltip).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(tooltip).toHaveCSS("border-top-color", "rgb(250, 250, 250)");
  expect(await tooltip.evaluate((element) => element.parentElement === document.body)).toBe(true);
  const anchor = await objectLink.boundingBox();
  const box = await tooltip.boundingBox();
  expect(box!.x).toBeGreaterThan(anchor!.x + anchor!.width);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
  await page.mouse.move(0, 0);
  await expect(tooltip).toHaveCount(0);
  await originalLink.focus();
  await expect(tooltip).toHaveText("Original post");
  await originalLink.press("Escape");
  await expect(tooltip).toHaveCount(0);
});
