import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from "@zip.js/zip.js";

import { expect, test } from "../../../../../host/e2e/support/playwright.ts";
import {
  NEW_VIBE_ID,
  VIBE_ID,
  installMockStore,
  type MockStore,
} from "../../../../../host/e2e/support/mockStore.ts";
import { X_ARCHIVE_CAPTURE_MIME } from "../contracts.ts";
import { mockXArchiveSkill } from "./support/mockXArchiveSkill.ts";

let mockStore: MockStore;

test.beforeEach(async ({ page }) => {
  mockStore = await installMockStore(page, { sourceSkills: [mockXArchiveSkill] });
  const target = mockStore.vibes[0];
  if (!target) throw new Error("Missing mocked target Vibe");
  delete target.pull;
});

test("an X archive suggests its source-owned title and creates no Vibe before confirmation", async ({
  page,
}) => {
  const source = await sourceArchive();
  await page.goto("/imports");
  await page.getByRole("button", { name: "Import into a new Vibe" }).click();
  await page.getByLabel("X archive ZIP").setInputFiles({
    name: "synthetic-x-archive.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(await source.arrayBuffer()),
  });
  await page.getByRole("button", { name: "Review X archive" }).click();

  await expect(page.getByLabel("VERIFY reconciliation")).toContainText("2 objects passed VERIFY");
  await expect(page.getByLabel("New Vibe title")).toHaveValue("@example_user Tweets");
  await expect(
    page
      .getByRole("list", { name: "Candidate media objects" })
      .locator('[data-element-presentation="image"]'),
  ).toBeVisible();
  expect(mockStore.vibes.some(({ uri }) => uri.endsWith(`/${NEW_VIBE_ID}`))).toBe(false);

  await page.getByRole("button", { name: "Confirm import" }).click();
  await expect(page.getByText("Target Vibe: @example_user Tweets", { exact: true })).toBeVisible();
  const created = mockStore.vibes.find(({ uri }) => uri.endsWith(`/${NEW_VIBE_ID}`));
  expect(created?.title).toBe("@example_user Tweets");
  expect(created?.objects).toHaveLength(2);
});

test("the generic file capability selectively captures and imports an X archive", async ({
  page,
}) => {
  const source = await sourceArchive();
  const initialObjects = mockStore.objects.size;
  const initialElements = mockStore.elements.size;

  await page.goto(`/vibes/${VIBE_ID}`);
  await page.getByLabel("Import source", { exact: true }).selectOption({ label: "X archive" });
  await expect(page.getByText("Up to 100 objects · capture limit 50 MB")).toBeVisible();
  await page.getByLabel("X archive ZIP").setInputFiles({
    name: "synthetic-x-archive.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(await source.arrayBuffer()),
  });
  await page.getByRole("button", { name: "Review X archive" }).click();

  const reconciliation = page.getByLabel("VERIFY reconciliation");
  await expect(reconciliation).toContainText("2 objects passed VERIFY");
  await expect(reconciliation).toContainText("4 source records → 2 candidates");
  await expect(reconciliation).toContainText("4 elements staged");
  await expect(page.getByRole("list", { name: "VERIFY checks" }).getByRole("listitem")).toHaveCount(
    8,
  );
  await expect(
    page.getByRole("list", { name: "Candidate media objects" }).locator("[data-import-candidate]"),
  ).toHaveCount(2);

  expect(mockStore.origins.size).toBe(1);
  const [origin] = [...mockStore.origins.values()];
  expect(origin?.document.mime).toBe(X_ARCHIVE_CAPTURE_MIME);
  expect(origin?.document.label).toBe("x-archive-example_user-selection.zip");
  expect(origin?.payload.includes("PRIVATE-DIRECT-MESSAGE-SENTINEL")).toBe(false);
  expect(mockStore.objects.size).toBe(initialObjects);
  expect(mockStore.elements.size).toBe(initialElements);

  await page.getByRole("button", { name: "Confirm import" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Imported 2 objects from x-archive-example_user-selection.zip.",
  );
  expect(mockStore.objects.size).toBe(initialObjects + 2);
  expect(mockStore.elements.size).toBe(initialElements + 4);
  const tweets = [...mockStore.objects.values()].filter(({ type }) => type === "tweet");
  expect(tweets.map(({ keys }) => keys?.x_tweet_id)).toEqual(["4", "3"]);
  expect(tweets[0]?.elements.map(({ role }) => role)).toEqual(["content", "content"]);
  expect(tweets[0]?.elements[1]?.alt).toBe("A synthetic pixel");
  expect(tweets[0]?.source.properties).not.toHaveProperty("text");
});

async function sourceArchive(): Promise<Blob> {
  const png = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  await writer.add(
    "data/account.js",
    new TextReader(
      assignment("account", [
        {
          account: {
            accountId: "42",
            username: "example_user",
            accountDisplayName: "Example User",
            archiveGeneratedAt: "2026-08-21T12:00:00Z",
          },
        },
      ]),
    ),
  );
  await writer.add(
    "data/manifest.js",
    new TextReader(
      `window.__THAR_CONFIG = ${JSON.stringify({
        userInfo: { accountId: "42", userName: "example_user", displayName: "Example User" },
        archiveInfo: { generationDate: "2026-08-21T12:00:00.000Z" },
        dataTypes: {
          tweets: {
            files: [{ fileName: "data/tweets.js", globalName: "YTD.tweets.part0", count: "4" }],
          },
        },
      })}`,
    ),
  );
  await writer.add(
    "data/tweets.js",
    new TextReader(
      assignment("tweets", [
        tweet("4", "2026-08-20T10:00:00Z", "Newest with a photo", {
          extended_entities: {
            media: [
              {
                type: "photo",
                media_url_https: "https://pbs.twimg.com/media/pixel.png",
                ext_alt_text: "A synthetic pixel",
              },
            ],
          },
        }),
        tweet("3", "2026-08-19T10:00:00Z", "Exact commentary https://t.co/quote", {
          quoted_status_id_str: "30",
          entities: {
            urls: [
              {
                url: "https://t.co/quote",
                expanded_url: "https://x.com/example/status/30",
              },
            ],
          },
          extended_entities: {
            media: [
              {
                type: "video",
                video_info: {
                  variants: [
                    {
                      content_type: "video/mp4",
                      bitrate: 1000,
                      url: "https://video.twimg.com/video.mp4",
                    },
                  ],
                },
              },
            ],
          },
        }),
        tweet("2", "2026-08-18T10:00:00Z", "Reply", { in_reply_to_status_id_str: "20" }),
        tweet("1", "2026-08-17T10:00:00Z", "RT @someone", {
          retweeted_status_id_str: "10",
        }),
      ]),
    ),
  );
  await writer.add("data/tweets_media/4-pixel.png", new Uint8ArrayReader(png));
  await writer.add(
    "data/tweets_media/3-video.mp4",
    new Uint8ArrayReader(new TextEncoder().encode("synthetic-mp4")),
  );
  await writer.add("data/direct-messages.js", new TextReader("PRIVATE-DIRECT-MESSAGE-SENTINEL"));
  return writer.close();
}

function assignment(target: "account" | "tweets", value: unknown): string {
  return `window.YTD.${target}.part0 = ${JSON.stringify(value)}`;
}

function tweet(
  id: string,
  createdAt: string,
  fullText: string,
  extra: Record<string, unknown> = {},
) {
  return {
    tweet: {
      id_str: id,
      conversation_id_str: id,
      created_at: createdAt,
      full_text: fullText,
      lang: "en",
      entities: { urls: [] },
      ...extra,
    },
  };
}
