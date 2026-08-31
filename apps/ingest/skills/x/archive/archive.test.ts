import { describe, expect, test } from "bun:test";
import {
  BlobWriter,
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  BlobReader,
  ZipWriter,
} from "@zip.js/zip.js";

import { compileXPostCandidates } from "../tweet-candidates.ts";
import { prepareXArchiveCapture } from "./browser-capture.ts";
import { X_ARCHIVE_CAPTURE_MIME } from "./contracts.ts";
import { xArchiveParser } from "./parser.ts";

const limits = {
  maxCandidates: 3,
  maxCaptureBytes: 1_024 * 1_024,
  maxElementBytes: 64,
  maxTotalElementBytes: 256,
} as const;

describe("X archive selective capture", () => {
  test("selects eligible posts, reads only their media, and revalidates the compact capture", async () => {
    const unrelated = "PRIVATE-DIRECT-MESSAGE-SENTINEL";
    const archive = await sourceArchive({ unrelated });
    const prepared = await prepareXArchiveCapture(
      new File([archive], "twitter-archive.zip", { type: "application/zip" }),
      limits,
      () => new Date("2026-08-22T12:00:00Z"),
    );

    expect(prepared.mime).toBe(X_ARCHIVE_CAPTURE_MIME);
    expect(prepared.blob.size).toBeLessThan(limits.maxCaptureBytes);
    expect([...(await unzip(prepared.blob)).keys()]).not.toContain("data/direct-messages.js");
    const selected = await xArchiveParser.parse(new Uint8Array(await prepared.blob.arrayBuffer()));
    expect(selected.posts.map(({ id }) => id)).toEqual(["105", "101", "100"]);
    expect(selected.counts).toMatchObject({
      sourceRecordCount: 7,
      repliesExcluded: 1,
      repostsExcluded: 1,
      quotesWithoutCommentaryExcluded: 1,
      authorMismatchesExcluded: 0,
      eligibleCount: 4,
      importedCount: 3,
      cap: 3,
    });
    const bundle = await compileXPostCandidates(selected, limits);
    expect(bundle.verify.ok).toBe(true);
    expect(bundle.verify.media_omissions).toEqual({
      missing_media: 1,
      unsupported_media: 1,
      element_too_large: 0,
      total_element_budget: 0,
    });
    expect(bundle.candidates[0]?.elements.map(({ kind }) => kind)).toEqual([
      "text",
      "image",
      "image",
    ]);
    expect(bundle.candidates[0]?.elements[1]?.alt).toBe("Synthetic landscape");
    expect(new TextDecoder().decode(bundle.candidates[1]?.elements[0]?.bytes)).toBe(
      "Commentary 🔥 https://t.co/quote",
    );
  });

  test("never evaluates archive JavaScript and rejects malformed assignments", async () => {
    (globalThis as { archiveExecuted?: boolean }).archiveExecuted = false;
    const archive = await sourceArchive({
      tweetsAssignment: `${tweetsAssignment()}\n;globalThis.archiveExecuted = true`,
    });
    await expect(prepareXArchiveCapture(new File([archive], "unsafe.zip"), limits)).rejects.toThrow(
      "malformed JSON",
    );
    expect((globalThis as { archiveExecuted?: boolean }).archiveExecuted).toBe(false);
  });

  test("rejects traversal and case-conflicting entries from the central directory", async () => {
    const traversal = await zip([
      ["data/account.js", accountAssignment()],
      ["data/tweets.js", tweetsAssignment()],
      ["../escape.txt", "nope"],
    ]);
    await expect(
      prepareXArchiveCapture(new File([traversal], "traversal.zip"), limits),
    ).rejects.toThrow(/[Uu]nsafe (?:filename|path)/);

    const conflict = await zip([
      ["data/account.js", accountAssignment()],
      ["DATA/ACCOUNT.JS", accountAssignment()],
      ["data/tweets.js", tweetsAssignment()],
    ]);
    await expect(
      prepareXArchiveCapture(new File([conflict], "conflict.zip"), limits),
    ).rejects.toThrow("case-conflicting");
  });

  test("declares oversized and missing media while continuing to later smaller attachments", async () => {
    const constrained = { ...limits, maxElementBytes: 4, maxTotalElementBytes: 200 };
    const archive = await sourceArchive({
      firstMedia: new Uint8Array(8),
      secondMedia: new Uint8Array(2),
    });
    const prepared = await prepareXArchiveCapture(new File([archive], "bounded.zip"), constrained);
    const selected = await xArchiveParser.parse(new Uint8Array(await prepared.blob.arrayBuffer()));
    const first = selected.posts[0]!;
    expect(first.attachments.map((attachment) => attachment.status)).toEqual([
      "omitted",
      "available",
      "omitted",
    ]);
    expect(first.attachments[0]).toMatchObject({ reason: "element_too_large", byteSize: 8 });
    expect((first.attachments[1] as { bytes: Uint8Array }).bytes.byteLength).toBe(2);
  });

  test("rejects undeclared compact-capture entries and changed media hashes", async () => {
    const prepared = await prepareXArchiveCapture(
      new File([await sourceArchive({})], "source.zip"),
      limits,
    );
    const entries = await unzip(prepared.blob);
    entries.set("unexpected.txt", new TextEncoder().encode("unexpected"));
    await expect(xArchiveParser.parse(await zipBytes(entries))).rejects.toThrow("undeclared entry");

    entries.delete("unexpected.txt");
    const mediaPath = [...entries.keys()].find((path) => path.startsWith("media/"))!;
    entries.set(mediaPath, new TextEncoder().encode("changed"));
    await expect(xArchiveParser.parse(await zipBytes(entries))).rejects.toThrow("integrity failed");
  });

  test("rejects highly compressed ZIP-bomb entries before reading their payload", async () => {
    const writer = new ZipWriter(new BlobWriter("application/zip"));
    await writer.add("data/account.js", new TextReader(accountAssignment()));
    await writer.add("data/tweets.js", new TextReader(tweetsAssignment()));
    await writer.add("data/unrelated.txt", new TextReader("0".repeat(2 * 1_024 * 1_024)), {
      level: 9,
    });
    const bomb = await writer.close();
    await expect(prepareXArchiveCapture(new File([bomb], "bomb.zip"), limits)).rejects.toThrow(
      "unsafe compression ratio",
    );
  });

  test("follows inert manifest declarations for multipart singular-layout archives", async () => {
    const raw = (id: string, day: number, media = false) => ({
      tweet: {
        id_str: id,
        conversation_id_str: id,
        created_at: `2026-08-${String(day).padStart(2, "0")}T10:00:00Z`,
        full_text: `Post ${id}`,
        entities: { urls: [] },
        ...(media
          ? {
              extended_entities: {
                media: [
                  {
                    type: "photo",
                    media_url_https: "https://pbs.twimg.com/media/singular.png",
                  },
                ],
              },
            }
          : {}),
      },
    });
    const archive = await zip([
      ["data/account.js", accountAssignment()],
      [
        "data/manifest.js",
        `window.__THAR_CONFIG = ${JSON.stringify({
          userInfo: { accountId: "42" },
          archiveInfo: { generationDate: "2026-08-21T12:00:00.000Z" },
          dataTypes: {
            tweet: {
              files: [
                { fileName: "data/tweet.js", globalName: "YTD.tweet.part0", count: "1" },
                {
                  fileName: "data/tweet-part1.js",
                  globalName: "YTD.tweet.part1",
                  count: "1",
                },
              ],
            },
          },
        })}`,
      ],
      ["data/tweet.js", `window.YTD.tweet.part0 = ${JSON.stringify([raw("10", 20)])}`],
      ["data/tweet-part1.js", `window.YTD.tweet.part1 = ${JSON.stringify([raw("11", 21, true)])}`],
      ["data/tweet_media/11-singular.png", new Uint8Array([1, 2, 3])],
    ]);
    const prepared = await prepareXArchiveCapture(new File([archive], "singular.zip"), limits);
    const compact = await unzip(prepared.blob);
    const manifest = JSON.parse(new TextDecoder().decode(compact.get("manifest.json"))) as {
      archiveGeneratedAt: string;
      archiveLayout: { tweetGlobal: string; mediaDirectory: string };
    };
    expect(manifest).toMatchObject({
      archiveGeneratedAt: "2026-08-21T12:00:00.000Z",
      archiveLayout: { tweetGlobal: "tweet", mediaDirectory: "data/tweet_media" },
    });
    const selected = await xArchiveParser.parse(new Uint8Array(await prepared.blob.arrayBuffer()));
    expect(selected.posts.map(({ id }) => id)).toEqual(["11", "10"]);
    expect(selected.posts[0]?.attachments[0]?.status).toBe("available");
  });
});

async function sourceArchive(options: {
  unrelated?: string;
  tweetsAssignment?: string;
  firstMedia?: Uint8Array;
  secondMedia?: Uint8Array;
}): Promise<Blob> {
  return zip([
    ["data/account.js", accountAssignment()],
    ["data/tweets.js", options.tweetsAssignment ?? tweetsAssignment()],
    [
      "data/tweets_media/105-first.jpg",
      options.firstMedia ?? new TextEncoder().encode("image-one"),
    ],
    [
      "data/tweets_media/105-second.png",
      options.secondMedia ?? new TextEncoder().encode("image-two"),
    ],
    ["data/tweets_media/101-video.mp4", new TextEncoder().encode("video-one")],
    ["data/direct-messages.js", options.unrelated ?? "unrelated"],
  ]);
}

function accountAssignment(): string {
  return `window.YTD.account.part0 = ${JSON.stringify([
    {
      account: {
        accountId: "42",
        username: "example_user",
        accountDisplayName: "Example User",
        archiveGeneratedAt: "2026-08-21T12:00:00Z",
      },
    },
  ])}`;
}

function tweetsAssignment(): string {
  const tweet = (
    id: string,
    createdAt: string,
    fullText: string,
    extra: Record<string, unknown> = {},
  ) => ({
    tweet: {
      id_str: id,
      conversation_id_str: id,
      created_at: createdAt,
      full_text: fullText,
      lang: "en",
      possibly_sensitive: false,
      edit_info: { initial: { editTweetIds: [id] } },
      entities: { urls: [] },
      ...extra,
    },
  });
  const quoteUrl = "https://t.co/quote";
  return `window.YTD.tweets.part0 = ${JSON.stringify([
    tweet("105", "2026-08-20T10:00:00Z", "Newest original", {
      extended_entities: {
        media: [
          {
            type: "photo",
            media_url_https: "https://pbs.twimg.com/media/first.jpg",
            ext_alt_text: "Synthetic landscape",
          },
          {
            type: "photo",
            media_url_https: "https://pbs.twimg.com/media/second.png",
          },
          { type: "audio" },
        ],
      },
    }),
    tweet("104", "2026-08-19T10:00:00Z", "Reply", { in_reply_to_status_id_str: "80" }),
    tweet("103", "2026-08-18T10:00:00Z", "RT @example repost", {
      retweeted_status_id_str: "81",
    }),
    tweet("102", "2026-08-17T10:00:00Z", quoteUrl, {
      quoted_status_id_str: "82",
      entities: {
        urls: [{ url: quoteUrl, expanded_url: "https://x.com/quoted/status/82" }],
      },
    }),
    tweet("101", "2026-08-16T10:00:00Z", `Commentary 🔥 ${quoteUrl}`, {
      quoted_status_id_str: "83",
      entities: {
        urls: [{ url: quoteUrl, expanded_url: "https://x.com/quoted/status/83" }],
      },
      extended_entities: {
        media: [
          {
            type: "video",
            video_info: {
              variants: [
                {
                  content_type: "application/x-mpegURL",
                  url: "https://video.twimg.com/video.m3u8",
                },
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
    tweet("100", "2026-08-16T10:00:00Z", "Same-time original", {
      extended_entities: {
        media: [
          {
            type: "photo",
            media_url_https: "https://pbs.twimg.com/media/not-packaged.jpg",
          },
        ],
      },
    }),
    tweet("99", "2026-08-15T10:00:00Z", "Older eligible original"),
  ])}`;
}

async function zip(entries: Array<[string, string | Uint8Array]>): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  for (const [path, value] of entries) {
    await writer.add(
      path,
      typeof value === "string" ? new TextReader(value) : new Uint8ArrayReader(value),
    );
  }
  return writer.close();
}

async function unzip(blob: Blob): Promise<Map<string, Uint8Array>> {
  const reader = new ZipReader(new BlobReader(blob));
  try {
    const result = new Map<string, Uint8Array>();
    for (const entry of await reader.getEntries()) {
      if (!entry.directory) result.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
    }
    return result;
  } finally {
    await reader.close();
  }
}

async function zipBytes(entries: Map<string, Uint8Array>): Promise<Uint8Array> {
  const blob = await zip([...entries].map(([path, bytes]) => [path, bytes]));
  return new Uint8Array(await blob.arrayBuffer());
}
