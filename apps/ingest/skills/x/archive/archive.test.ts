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

import { sha256 } from "../contracts.ts";
import { compileXPostCandidates } from "../tweet-candidates.ts";
import { prepareXArchiveCapture } from "./browser-capture.ts";
import {
  X_ARCHIVE_CAPTURE_FORMAT,
  X_ARCHIVE_CAPTURE_MIME,
  assertSelectionManifest,
  associateArchiveNoteTweets,
  normalizeRawArchiveTweet,
  parseRawArchiveNoteTweets,
  type RawXArchiveTweetEnvelope,
} from "./contracts.ts";
import { xArchiveParser } from "./parser.ts";
import { xArchiveSourceSkill } from "./source.ts";

const limits = {
  maxCandidates: 3,
  maxCaptureBytes: 1_024 * 1_024,
  maxElementBytes: 64,
  maxTotalElementBytes: 256,
} as const;

const currentShapes = (await Bun.file(
  new URL("../fixtures/archive-current-shapes.json", import.meta.url),
).json()) as {
  truncatedNoteTweet: RawXArchiveTweetEnvelope;
  currentNoteTweet: { noteTweet: Readonly<Record<string, unknown>> };
  bareRepost: RawXArchiveTweetEnvelope;
  stringIndexTweet: RawXArchiveTweetEnvelope;
};

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
    const selected = await xArchiveParser.parse(
      new Uint8Array(await prepared.blob.arrayBuffer()),
      limits,
    );
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
    const constrained = { ...limits, maxElementBytes: 40, maxTotalElementBytes: 200 };
    const archive = await sourceArchive({
      firstMedia: new Uint8Array(64),
      secondMedia: new Uint8Array(2),
    });
    const prepared = await prepareXArchiveCapture(new File([archive], "bounded.zip"), constrained);
    const selected = await xArchiveParser.parse(
      new Uint8Array(await prepared.blob.arrayBuffer()),
      constrained,
    );
    const first = selected.posts[0]!;
    expect(first.attachments.map((attachment) => attachment.status)).toEqual([
      "omitted",
      "available",
      "omitted",
    ]);
    expect(first.attachments[0]).toMatchObject({ reason: "element_too_large", byteSize: 64 });
    expect((first.attachments[1] as { bytes: Uint8Array }).bytes.byteLength).toBe(2);
  });

  test("rejects undeclared compact-capture entries and changed media hashes", async () => {
    const prepared = await prepareXArchiveCapture(
      new File([await sourceArchive({})], "source.zip"),
      limits,
    );
    const entries = await unzip(prepared.blob);
    entries.set("unexpected.txt", new TextEncoder().encode("unexpected"));
    await expect(xArchiveParser.parse(await zipBytes(entries), limits)).rejects.toThrow(
      "undeclared entry",
    );

    entries.delete("unexpected.txt");
    const mediaPath = [...entries.keys()].find((path) => path.startsWith("media/"))!;
    entries.set(mediaPath, new Uint8Array(entries.get(mediaPath)!.byteLength).fill(0xff));
    await expect(xArchiveParser.parse(await zipBytes(entries), limits)).rejects.toThrow(
      "integrity failed",
    );
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
    const selected = await xArchiveParser.parse(
      new Uint8Array(await prepared.blob.arrayBuffer()),
      limits,
    );
    expect(selected.posts.map(({ id }) => id)).toEqual(["11", "10"]);
    expect(selected.posts[0]?.attachments[0]?.status).toBe("available");
  });

  test("associates current Note Tweet rows without assuming their ID and preserves exact UTF-8", async () => {
    const noteLimits = {
      ...limits,
      maxElementBytes: 1_024,
      maxTotalElementBytes: 4_096,
    };
    const archive = await zip([
      ["data/account.js", accountAssignment()],
      [
        "data/manifest.js",
        `window.__THAR_CONFIG = ${JSON.stringify({
          userInfo: { accountId: "42" },
          dataTypes: {
            tweets: {
              files: [{ fileName: "data/tweets.js", globalName: "YTD.tweets.part0", count: "1" }],
            },
            noteTweet: {
              files: [
                {
                  fileName: "data/note-tweet.js",
                  globalName: "YTD.note_tweet.part0",
                  count: "1",
                },
              ],
            },
          },
        })}`,
      ],
      [
        "data/tweets.js",
        `window.YTD.tweets.part0 = ${JSON.stringify([currentShapes.truncatedNoteTweet])}`,
      ],
      [
        "data/note-tweet.js",
        `window.YTD.note_tweet.part0 = ${JSON.stringify([currentShapes.currentNoteTweet])}`,
      ],
    ]);
    const prepared = await prepareXArchiveCapture(
      new File([archive], "note-tweet.zip"),
      noteLimits,
    );
    const compact = await unzip(prepared.blob);
    expect([...compact.keys()].sort()).toEqual(["manifest.json", "posts.json"]);

    const bytes = new Uint8Array(await prepared.blob.arrayBuffer());
    const selected = await xArchiveParser.parse(bytes, noteLimits);
    const expectedText = String(
      (currentShapes.currentNoteTweet.noteTweet.core as Readonly<Record<string, unknown>>).text,
    );
    expect(selected.posts[0]?.id).toBe("2000000000000000001");
    expect(selected.posts[0]?.text).toBe(expectedText);
    expect(selected.posts[0]?.entities?.urls).toEqual([
      {
        start: 53,
        end: 70,
        url: "https://t.co/full",
        expanded_url: "https://example.test/full",
      },
    ]);

    const bundle = await xArchiveSourceSkill.compiledSource.compile({ bytes, limits: noteLimits });
    expect(new TextDecoder().decode(bundle.candidates[0]?.elements[0]?.bytes)).toBe(expectedText);
  });

  test("rejects ambiguous Note Tweet associations", () => {
    const duplicate = structuredClone(currentShapes.truncatedNoteTweet) as {
      tweet: Record<string, unknown>;
    };
    duplicate.tweet.id_str = "2000000000000000004";
    duplicate.tweet.conversation_id_str = "2000000000000000004";
    expect(() =>
      associateArchiveNoteTweets(
        [currentShapes.truncatedNoteTweet, duplicate],
        parseRawArchiveNoteTweets([currentShapes.currentNoteTweet]),
      ),
    ).toThrow("ambiguous");
  });

  test("ignores orphan and structurally ineligible Note Tweets but protects eligible exact text", () => {
    const orphan = structuredClone(currentShapes.currentNoteTweet) as {
      noteTweet: Record<string, unknown>;
    };
    orphan.noteTweet.createdAt = "2025-12-03T04:52:54.000Z";
    expect(
      associateArchiveNoteTweets(
        [currentShapes.truncatedNoteTweet],
        parseRawArchiveNoteTweets([orphan]),
      ),
    ).toEqual([{ tweet: currentShapes.truncatedNoteTweet.tweet }]);

    const reply = structuredClone(currentShapes.truncatedNoteTweet) as {
      tweet: Record<string, unknown>;
    };
    reply.tweet.in_reply_to_status_id_str = "99";
    expect(
      associateArchiveNoteTweets(
        [reply],
        parseRawArchiveNoteTweets([currentShapes.currentNoteTweet]),
      ),
    ).toEqual([{ tweet: reply.tweet }]);

    const excludedMatch = structuredClone(currentShapes.truncatedNoteTweet) as {
      tweet: Record<string, unknown>;
    };
    excludedMatch.tweet.retweeted_status_id_str = "98";

    const differentEligible = structuredClone(currentShapes.truncatedNoteTweet) as {
      tweet: Record<string, unknown>;
    };
    differentEligible.tweet.id_str = "2000000000000000005";
    differentEligible.tweet.conversation_id_str = "2000000000000000005";
    differentEligible.tweet.full_text = "A different eligible post";
    expect(
      associateArchiveNoteTweets(
        [differentEligible, excludedMatch],
        parseRawArchiveNoteTweets([currentShapes.currentNoteTweet]),
      ),
    ).toEqual([{ tweet: differentEligible.tweet }, { tweet: excludedMatch.tweet }]);

    const matchingEligible = structuredClone(currentShapes.truncatedNoteTweet) as {
      tweet: Record<string, unknown>;
    };
    matchingEligible.tweet.id_str = "2000000000000000006";
    matchingEligible.tweet.conversation_id_str = "2000000000000000006";
    expect(() =>
      associateArchiveNoteTweets(
        [matchingEligible, excludedMatch],
        parseRawArchiveNoteTweets([currentShapes.currentNoteTweet]),
      ),
    ).toThrow("ambiguous");

    const contradiction = structuredClone(currentShapes.currentNoteTweet) as {
      noteTweet: { core: Record<string, unknown> };
    };
    contradiction.noteTweet.core.text = "A different long-form post";
    contradiction.noteTweet.core.urls = [];
    expect(() =>
      associateArchiveNoteTweets(
        [currentShapes.truncatedNoteTweet],
        parseRawArchiveNoteTweets([contradiction]),
      ),
    ).toThrow("no tweet association");
  });

  test("preserves repeated Note Tweet hashtags and cashtags by provider order", () => {
    const tweet = structuredClone(currentShapes.truncatedNoteTweet) as {
      tweet: Record<string, unknown>;
    };
    const truncated = "Long #tag then #tag and $CASH then $CASH…";
    const full = `${truncated.slice(0, -1)} with more exact text`;
    tweet.tweet.full_text = truncated;
    const note = structuredClone(currentShapes.currentNoteTweet) as {
      noteTweet: { core: Record<string, unknown> };
    };
    note.noteTweet.core.text = full;
    note.noteTweet.core.urls = [];
    note.noteTweet.core.mentions = [];
    note.noteTweet.core.hashtags = ["tag", "tag"];
    note.noteTweet.core.cashtags = ["CASH", "CASH"];

    const [associated] = associateArchiveNoteTweets([tweet], parseRawArchiveNoteTweets([note]));
    const normalized = normalizeRawArchiveTweet(associated!, {
      id: "42",
      handle: "example_user",
    });
    const repeatedSpans = (token: string) => {
      const first = full.indexOf(token);
      const second = full.indexOf(token, first + token.length);
      return [
        { start: first, end: first + token.length, tag: token.slice(1) },
        { start: second, end: second + token.length, tag: token.slice(1) },
      ];
    };
    expect(normalized.post.entities?.hashtags).toEqual(repeatedSpans("#tag"));
    expect(normalized.post.entities?.cashtags).toEqual(repeatedSpans("$CASH"));
  });

  test("bounds compact-capture account metadata before replay", () => {
    const manifest = {
      format: X_ARCHIVE_CAPTURE_FORMAT,
      selectedAt: "2026-08-21T12:00:00.000Z",
      account: { id: "42", handle: "example_user", name: "Example User" },
      archiveLayout: { tweetGlobal: "tweets", mediaDirectory: "data/tweets_media" },
      counts: {
        sourceRecordCount: 0,
        repliesExcluded: 0,
        repostsExcluded: 0,
        quotesWithoutCommentaryExcluded: 0,
        authorMismatchesExcluded: 0,
        eligibleCount: 0,
        importedCount: 0,
        cap: 100,
      },
      includedMedia: [],
      mediaOmissions: [],
    };
    expect(() => assertSelectionManifest(manifest)).not.toThrow();
    expect(() =>
      assertSelectionManifest({
        ...manifest,
        account: { ...manifest.account, handle: "a".repeat(16) },
      }),
    ).toThrow("account metadata");
    expect(() =>
      assertSelectionManifest({
        ...manifest,
        account: { ...manifest.account, name: "🔥".repeat(65) },
      }),
    ).toThrow("account metadata");
    expect(() =>
      assertSelectionManifest({
        ...manifest,
        account: { ...manifest.account, name: "unsafe\u0000name" },
      }),
    ).toThrow("account metadata");
  });

  test("normalizes homogeneous decimal-string entity pairs and rejects mixed pairs", () => {
    const account = { id: "42", handle: "example_user" } as const;
    const normalized = normalizeRawArchiveTweet(currentShapes.stringIndexTweet, account);
    expect(normalized.post.entities?.urls?.[0]).toMatchObject({ start: 5, end: 19 });

    const mixed = structuredClone(currentShapes.stringIndexTweet) as {
      tweet: Record<string, unknown>;
    };
    const entities = mixed.tweet.entities as Record<string, unknown>;
    const urls = entities.urls as Array<Record<string, unknown>>;
    urls[0]!.indices = [5, "19"];
    expect(() => normalizeRawArchiveTweet(mixed, account)).toThrow("indices");
  });

  test("rejects more attachments than the provider archive shape permits", () => {
    const tooMany = structuredClone(currentShapes.stringIndexTweet) as {
      tweet: Record<string, unknown>;
    };
    tooMany.tweet.extended_entities = {
      media: Array.from({ length: 5 }, (_, index) => ({
        type: "photo",
        media_url_https: `https://pbs.twimg.com/media/${index}.jpg`,
      })),
    };
    expect(() => normalizeRawArchiveTweet(tooMany, { id: "42", handle: "example_user" })).toThrow(
      "too many attachments",
    );
  });

  test("excludes provider-shaped bare reposts without inventing a target ID", async () => {
    const original = {
      tweet: {
        id_str: "2000000000000000005",
        conversation_id_str: "2000000000000000005",
        created_at: "Tue Dec 02 05:02:00 +0000 2025",
        full_text: "An eligible original",
        entities: { hashtags: [], symbols: [], user_mentions: [], urls: [] },
      },
    };
    const archive = await zip([
      ["data/account.js", accountAssignment()],
      [
        "data/tweets.js",
        `window.YTD.tweets.part0 = ${JSON.stringify([currentShapes.bareRepost, original])}`,
      ],
    ]);
    const prepared = await prepareXArchiveCapture(new File([archive], "bare-repost.zip"), limits);
    const selected = await xArchiveParser.parse(
      new Uint8Array(await prepared.blob.arrayBuffer()),
      limits,
    );
    expect(selected.posts.map(({ id }) => id)).toEqual(["2000000000000000005"]);
    expect(selected.counts).toMatchObject({ repostsExcluded: 1, sourceRecordCount: 2 });
  });

  test("re-enforces per-element limits through the compiled-source server boundary", async () => {
    const prepared = await prepareXArchiveCapture(
      new File([await sourceArchive({})], "source.zip"),
      limits,
    );
    const entries = await unzip(prepared.blob);
    const manifest = JSON.parse(new TextDecoder().decode(entries.get("manifest.json"))) as {
      includedMedia: Array<{
        capturePath: string;
        byteSize: number;
        contentHash: `sha256:${string}`;
      }>;
    };
    const included = manifest.includedMedia[0]!;
    const oversized = new Uint8Array(4_096);
    included.byteSize = oversized.byteLength;
    included.contentHash = await sha256(oversized);
    entries.set(included.capturePath, oversized);
    entries.set("manifest.json", new TextEncoder().encode(JSON.stringify(manifest)));

    await expect(
      xArchiveSourceSkill.compiledSource.compile({
        bytes: await zipBytes(entries),
        limits,
      }),
    ).rejects.toThrow("element limit");
  });

  test("re-enforces the aggregate text and media budget on compact captures", async () => {
    const prepared = await prepareXArchiveCapture(
      new File([await sourceArchive({})], "source.zip"),
      limits,
    );
    const aggregateLimits = { ...limits, maxElementBytes: 1_024, maxTotalElementBytes: 80 };
    await expect(
      xArchiveSourceSkill.compiledSource.compile({
        bytes: new Uint8Array(await prepared.blob.arrayBuffer()),
        limits: aggregateLimits,
      }),
    ).rejects.toThrow("aggregate element budget");
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
