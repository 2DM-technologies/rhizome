import { describe, expect, test } from "bun:test";
import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from "@zip.js/zip.js";

import { sha256 } from "../contracts.ts";
import { X_SOURCE_LIMITS } from "../definition.ts";
import { normalizeXTextSpan } from "../entities.ts";
import { compileXPostCandidates } from "../tweet-candidates.ts";
import {
  X_OAUTH_CAPTURE_FORMAT,
  X_OAUTH_CAPTURE_MIME,
  X_OAUTH_MANIFEST_PATH,
  X_OAUTH_TIMELINE_PATH,
  normalizeXOAuthTimeline,
  parseXOAuthCapture,
  type XOAuthCaptureManifest,
} from "./parser.ts";
import type { XApiPost, XApiTimelinePage } from "./timeline.ts";

const account = { id: "42", handle: "example_user", name: "Example User" } as const;
const retrievedAt = "2026-08-21T12:00:00.000Z";

describe("X OAuth parser", () => {
  test("preserves exact text and selected photo/HTTPS MP4 media order with association alt", async () => {
    const timeline = page(
      [
        post({
          id: "105",
          text: "Exact 🔥 text https://t.co/article",
          attachments: { media_keys: ["photo-1", "video-1", "missing-1", "poll-1"] },
          entities: {
            urls: [
              {
                start: 13,
                end: 33,
                url: "https://t.co/article",
                expanded_url: "https://example.test/article",
              },
            ],
          },
        }),
      ],
      [
        {
          media_key: "photo-1",
          type: "photo",
          url: "https://pbs.twimg.com/media/photo-1.jpg",
          alt_text: "Synthetic photo",
        },
        {
          media_key: "video-1",
          type: "video",
          variants: [
            { content_type: "application/x-mpegURL", url: "https://video.twimg.com/video.m3u8" },
            {
              bit_rate: 256_000,
              content_type: "video/mp4",
              url: "https://video.twimg.com/video-low.mp4",
            },
            {
              bit_rate: 832_000,
              content_type: "video/mp4",
              url: "https://video.twimg.com/video-high.mp4",
            },
          ],
        },
        { media_key: "poll-1", type: "poll" },
      ],
    );
    const image = new TextEncoder().encode("image-one");
    const video = new TextEncoder().encode("video-one");
    const bytes = await captureBytes(
      timeline,
      [
        {
          postId: "105",
          attachmentIndex: 0,
          mediaKey: "photo-1",
          sourceUrl: "https://pbs.twimg.com/media/photo-1.jpg",
          capturePath: "media/0000-photo-1.jpg",
          kind: "image",
          mime: "image/jpeg",
          alt: "Synthetic photo",
          bytes: image,
        },
        {
          postId: "105",
          attachmentIndex: 1,
          mediaKey: "video-1",
          sourceUrl: "https://video.twimg.com/video-high.mp4",
          capturePath: "media/0001-video-1.mp4",
          kind: "video",
          mime: "video/mp4",
          bytes: video,
        },
      ],
      [
        {
          postId: "105",
          attachmentIndex: 2,
          mediaKey: "missing-1",
          reason: "missing_media",
        },
        {
          postId: "105",
          attachmentIndex: 3,
          mediaKey: "poll-1",
          reason: "unsupported_media",
        },
      ],
    );

    const parsed = await parseXOAuthCapture(bytes, X_SOURCE_LIMITS);
    const bundle = await compileXPostCandidates(parsed.selection, X_SOURCE_LIMITS);
    const candidate = bundle.candidates[0]!;
    expect(new TextDecoder().decode(candidate.elements[0]!.bytes)).toBe(
      "Exact 🔥 text https://t.co/article",
    );
    expect(candidate.elements.map(({ kind }) => kind)).toEqual(["text", "image", "video"]);
    expect(candidate.elements[1]).toMatchObject({
      alt: "Synthetic photo",
      mime: "image/jpeg",
      byteSize: image.byteLength,
    });
    expect(candidate.elements[2]).toMatchObject({ mime: "video/mp4", byteSize: video.byteLength });
    expect(candidate.sourceProperties.media_omissions).toEqual([
      { attachment_index: 2, source_ref: "missing-1", reason: "missing_media" },
      { attachment_index: 3, source_ref: "poll-1", reason: "unsupported_media" },
    ]);
    expect(candidate.sourceProperties.entities).toEqual({
      urls: [
        {
          start: 14,
          end: 34,
          url: "https://t.co/article",
          expanded_url: "https://example.test/article",
        },
      ],
    });
  });

  test("normalizes provider scalar entity offsets to JavaScript UTF-16 and rechecks quote eligibility", () => {
    const text = "🔥 authored https://t.co/quote";
    const token = "https://t.co/quote";
    const scalarStart = [..."🔥 authored "].length;
    const span = normalizeXTextSpan(text, token, scalarStart, scalarStart + [...token].length);
    expect(span).toEqual({ start: text.indexOf(token), end: text.length });

    const normalized = normalizeXOAuthTimeline({
      account,
      timeline: page([
        post({
          id: "103",
          text,
          referenced_tweets: [{ type: "quoted", id: "70" }],
          entities: {
            urls: [
              {
                start: scalarStart,
                end: scalarStart + [...token].length,
                url: token,
                expanded_url: "https://x.com/quoted/status/70",
              },
            ],
          },
        }),
        post({
          id: "102",
          text: token,
          referenced_tweets: [{ type: "quoted", id: "71" }],
          entities: {
            urls: [
              {
                start: 0,
                end: token.length,
                url: token,
                expanded_url: "https://x.com/quoted/status/71",
              },
            ],
          },
        }),
        post({
          id: "101",
          text: "Provider leaked a reply despite request exclusions",
          referenced_tweets: [{ type: "replied_to", id: "60" }],
        }),
        post({
          id: "100",
          text: "Provider leaked a repost despite request exclusions",
          referenced_tweets: [{ type: "retweeted", id: "59" }],
        }),
      ]),
      limits: X_SOURCE_LIMITS,
      retrievedAt,
    });

    expect(normalized.selection.posts.map(({ id }) => id)).toEqual(["103"]);
    expect(normalized.selection.counts).toMatchObject({
      repliesExcluded: 1,
      repostsExcluded: 1,
      quotesWithoutCommentaryExcluded: 1,
      eligibleCount: 1,
      importedCount: 1,
    });
    expect(normalized.selection.posts[0]!.references[0]!.textSpan).toEqual(span);
    expect(normalized.selection.posts[0]!.entities).toEqual({
      urls: [
        {
          ...span,
          url: token,
          expanded_url: "https://x.com/quoted/status/70",
        },
      ],
    });
  });

  test("recovers a long-form quote URL from top-level entities when Note Tweet entities are absent", () => {
    const quoteUrl = "https://t.co/quote";
    const noteText = `Long-form authored commentary ${quoteUrl}`;
    const topLevelText = `Long-form authored commentary… ${quoteUrl}`;
    const normalized = normalizeXOAuthTimeline({
      account,
      timeline: page([
        post({
          id: "104",
          text: topLevelText,
          note_tweet: { text: noteText },
          referenced_tweets: [{ type: "quoted", id: "70" }],
          entities: {
            urls: [
              {
                start: topLevelText.indexOf(quoteUrl),
                end: topLevelText.indexOf(quoteUrl) + quoteUrl.length,
                url: quoteUrl,
                expanded_url: "https://x.com/quoted/status/70",
              },
            ],
          },
        }),
      ]),
      limits: X_SOURCE_LIMITS,
      retrievedAt,
    });

    const imported = normalized.selection.posts[0]!;
    const start = noteText.indexOf(quoteUrl);
    expect(imported.text).toBe(noteText);
    expect(imported.references).toEqual([
      {
        kind: "quoted",
        postId: "70",
        url: "https://x.com/quoted/status/70",
        textUrl: quoteUrl,
        textSpan: { start, end: start + quoteUrl.length },
      },
    ]);
    expect(imported.entities?.urls).toEqual([
      {
        start,
        end: start + quoteUrl.length,
        url: quoteUrl,
        expanded_url: "https://x.com/quoted/status/70",
      },
    ]);
  });

  test("enriches a long-form quote entity whose expanded URL exists only at the top level", () => {
    const quoteUrl = "https://t.co/quote";
    const noteText = `Long-form authored commentary ${quoteUrl}`;
    const topLevelText = `Long-form authored commentary… ${quoteUrl}`;
    const start = noteText.indexOf(quoteUrl);
    const normalized = normalizeXOAuthTimeline({
      account,
      timeline: page([
        post({
          id: "105",
          text: topLevelText,
          note_tweet: {
            text: noteText,
            entities: {
              urls: [{ start, end: start + quoteUrl.length, url: quoteUrl }],
            },
          },
          referenced_tweets: [{ type: "quoted", id: "70" }],
          entities: {
            urls: [
              {
                start: topLevelText.indexOf(quoteUrl),
                end: topLevelText.indexOf(quoteUrl) + quoteUrl.length,
                url: quoteUrl,
                expanded_url: "https://x.com/quoted/status/70",
              },
            ],
          },
        }),
      ]),
      limits: X_SOURCE_LIMITS,
      retrievedAt,
    });

    const imported = normalized.selection.posts[0]!;
    expect(imported.references).toEqual([
      {
        kind: "quoted",
        postId: "70",
        url: "https://x.com/quoted/status/70",
        textUrl: quoteUrl,
        textSpan: { start, end: start + quoteUrl.length },
      },
    ]);
    expect(imported.entities?.urls).toEqual([
      {
        start,
        end: start + quoteUrl.length,
        url: quoteUrl,
        expanded_url: "https://x.com/quoted/status/70",
      },
    ]);
  });

  test("enriches and deduplicates equivalent partial Note Tweet quote entities", () => {
    const quoteUrl = "https://t.co/quote";
    const noteText = `${"a".repeat(250_000)} ${quoteUrl}`;
    const topLevelText = `Long-form authored commentary… ${quoteUrl}`;
    const start = noteText.indexOf(quoteUrl);
    const partial = { url: quoteUrl };
    const normalized = normalizeXOAuthTimeline({
      account,
      timeline: page([
        post({
          id: "107",
          text: topLevelText,
          note_tweet: {
            text: noteText,
            entities: { urls: Array.from({ length: 1_024 }, () => partial) },
          },
          referenced_tweets: [{ type: "quoted", id: "70" }],
          entities: {
            urls: [
              {
                start: topLevelText.indexOf(quoteUrl),
                end: topLevelText.indexOf(quoteUrl) + quoteUrl.length,
                url: quoteUrl,
                expanded_url: "https://x.com/quoted/status/70",
              },
            ],
          },
        }),
      ]),
      limits: X_SOURCE_LIMITS,
      retrievedAt,
    });

    expect(normalized.selection.posts[0]!.entities?.urls).toEqual([
      {
        start,
        end: start + quoteUrl.length,
        url: quoteUrl,
        expanded_url: "https://x.com/quoted/status/70",
      },
    ]);
  });

  test("rejects invalid top-level quote evidence before deriving a Note Tweet entity", () => {
    const quoteUrl = "https://t.co/quote";
    const noteText = `Long-form authored commentary ${quoteUrl}`;
    const quoteEntity = {
      start: 0,
      end: 3,
      url: quoteUrl,
      expanded_url: "https://x.com/quoted/status/70",
    };
    const timeline = (
      text: string,
      entity: {
        readonly url: string;
        readonly expanded_url?: string;
        readonly start?: number;
        readonly end?: number;
      },
    ) =>
      page([
        post({
          id: "106",
          text,
          note_tweet: { text: noteText },
          referenced_tweets: [{ type: "quoted", id: "70" }],
          entities: { urls: [entity] },
        }),
      ]);

    expect(() =>
      normalizeXOAuthTimeline({
        account,
        timeline: timeline(`Truncated… ${quoteUrl}`, quoteEntity),
        limits: X_SOURCE_LIMITS,
        retrievedAt,
      }),
    ).toThrow("offsets do not match");
    expect(() =>
      normalizeXOAuthTimeline({
        account,
        timeline: timeline("Truncated without its URL", {
          url: quoteUrl,
          expanded_url: quoteEntity.expanded_url,
        }),
        limits: X_SOURCE_LIMITS,
        retrievedAt,
      }),
    ).toThrow("no unambiguous exact-text span");
  });

  test("normalizes provider entities into exact-text spans", async () => {
    const mention = "@Friend";
    const hashtag = "#Topic";
    const cashtag = "$CASH";
    const text = `Equivalent 🔥 ${mention} ${hashtag} ${cashtag} https://t.co/quote`;
    const quoteUrl = "https://t.co/quote";
    const expandedQuoteUrl = "https://x.com/quoted/status/70";
    const quoteStart = text.indexOf(quoteUrl);
    const providerSpan = (token: string) => ({
      start: [...text.slice(0, text.indexOf(token))].length,
      end: [...text.slice(0, text.indexOf(token) + token.length)].length,
    });
    const provider = normalizeXOAuthTimeline({
      account,
      timeline: page([
        post({
          id: "100",
          text,
          referenced_tweets: [{ type: "quoted", id: "70" }],
          entities: {
            mentions: [{ ...providerSpan(mention), username: "Friend" }],
            hashtags: [{ ...providerSpan(hashtag), tag: "Topic" }],
            cashtags: [{ ...providerSpan(cashtag), tag: "CASH" }],
            urls: [
              {
                start: [...text.slice(0, quoteStart)].length,
                end: [...text.slice(0, quoteStart + quoteUrl.length)].length,
                url: quoteUrl,
                expanded_url: expandedQuoteUrl,
              },
            ],
          },
        }),
      ]),
      limits: X_SOURCE_LIMITS,
      retrievedAt,
    }).selection;
    const providerBundle = await compileXPostCandidates(provider, X_SOURCE_LIMITS);
    expect(providerBundle.candidates[0]!.sourceProperties.entities).toEqual({
      urls: [
        {
          start: quoteStart,
          end: quoteStart + quoteUrl.length,
          url: quoteUrl,
          expanded_url: expandedQuoteUrl,
        },
      ],
      mentions: [
        {
          start: text.indexOf(mention),
          end: text.indexOf(mention) + mention.length,
          username: "Friend",
        },
      ],
      hashtags: [
        {
          start: text.indexOf(hashtag),
          end: text.indexOf(hashtag) + hashtag.length,
          tag: "Topic",
        },
      ],
      cashtags: [
        {
          start: text.indexOf(cashtag),
          end: text.indexOf(cashtag) + cashtag.length,
          tag: "CASH",
        },
      ],
    });
  });

  test("caps after eligibility, rejects more than one provider page, and accepts zero posts", () => {
    const three = [
      post({ id: "103", text: "eligible newest" }),
      post({
        id: "102",
        text: "reply",
        referenced_tweets: [{ type: "replied_to", id: "1" }],
      }),
      post({ id: "101", text: "eligible older" }),
    ];
    const selection = normalizeXOAuthTimeline({
      account,
      timeline: page(three),
      limits: { ...X_SOURCE_LIMITS, maxCandidates: 1 },
      retrievedAt,
    }).selection;
    expect(selection.posts.map(({ id }) => id)).toEqual(["103"]);
    expect(selection.counts).toMatchObject({
      sourceRecordCount: 3,
      eligibleCount: 2,
      importedCount: 1,
    });

    const tooMany = Array.from({ length: 101 }, (_, index) =>
      post({ id: String(1_000 + index), text: `post ${index}` }),
    );
    expect(() =>
      normalizeXOAuthTimeline({
        account,
        timeline: page(tooMany),
        limits: X_SOURCE_LIMITS,
        retrievedAt,
      }),
    ).toThrow("one-page product cap");

    const empty = normalizeXOAuthTimeline({
      account,
      timeline: page([]),
      limits: X_SOURCE_LIMITS,
      retrievedAt,
    });
    expect(empty.selection.posts).toEqual([]);
    expect(empty.selection.counts).toMatchObject({ eligibleCount: 0, importedCount: 0 });
    expect(empty.checkpoint).toBeUndefined();
  });

  test("fails closed on provider errors, identity gaps, quote ambiguity, and media tampering", async () => {
    expect(() =>
      normalizeXOAuthTimeline({
        account,
        timeline: { ...page([]), errors: [{ title: "rate limit" }] },
        limits: X_SOURCE_LIMITS,
        retrievedAt,
      }),
    ).toThrow("provider errors");
    expect(() =>
      normalizeXOAuthTimeline({
        account,
        timeline: page([{ ...post({ id: "1" }), author_id: undefined } as never]),
        limits: X_SOURCE_LIMITS,
        retrievedAt,
      }),
    ).toThrow("author is invalid");
    expect(() =>
      normalizeXOAuthTimeline({
        account,
        timeline: page([post({ id: "1", referenced_tweets: [{ type: "quoted", id: "2" }] })]),
        limits: X_SOURCE_LIMITS,
        retrievedAt,
      }),
    ).toThrow("lacks its provider URL entity");
    expect(() =>
      normalizeXOAuthTimeline({
        account,
        timeline: page([
          post({
            id: "2",
            text: "bad https://t.co/offset",
            entities: {
              urls: [{ start: 0, end: 3, url: "https://t.co/offset" }],
            },
          }),
        ]),
        limits: X_SOURCE_LIMITS,
        retrievedAt,
      }),
    ).toThrow("offsets do not match");
    expect(() =>
      normalizeXOAuthTimeline({
        account,
        timeline: page([
          post({
            id: "3",
            text: "https://t.co/a https://t.co/b",
            referenced_tweets: [{ type: "quoted", id: "70" }],
            entities: {
              urls: [
                {
                  start: 0,
                  end: 14,
                  url: "https://t.co/a",
                  expanded_url: "https://x.com/quoted/status/70",
                },
                {
                  start: 15,
                  end: 29,
                  url: "https://t.co/b",
                  expanded_url: "https://x.com/other/status/70",
                },
              ],
            },
          }),
        ]),
        limits: X_SOURCE_LIMITS,
        retrievedAt,
      }),
    ).toThrow("lacks its provider URL entity");

    const timeline = page(
      [post({ id: "1", attachments: { media_keys: ["photo"] } })],
      [{ media_key: "photo", type: "photo", url: "https://pbs.twimg.com/photo.jpg" }],
    );
    const bytes = await captureBytes(
      timeline,
      [
        {
          postId: "1",
          attachmentIndex: 0,
          mediaKey: "photo",
          sourceUrl: "https://pbs.twimg.com/photo.jpg",
          capturePath: "media/photo.jpg",
          kind: "image",
          mime: "image/jpeg",
          bytes: new TextEncoder().encode("expected"),
        },
      ],
      [],
      new TextEncoder().encode("tampered"),
    );
    await expect(parseXOAuthCapture(bytes, X_SOURCE_LIMITS)).rejects.toThrow("integrity failed");
    await expect(
      parseXOAuthCapture(bytes, {
        ...X_SOURCE_LIMITS,
        maxElementBytes: X_SOURCE_LIMITS.maxElementBytes - 1,
      }),
    ).rejects.toThrow("limits do not match");

    const wrongDeclaredSize = await captureBytes(
      timeline,
      [
        {
          postId: "1",
          attachmentIndex: 0,
          mediaKey: "photo",
          sourceUrl: "https://pbs.twimg.com/photo.jpg",
          capturePath: "media/photo.jpg",
          kind: "image",
          mime: "image/jpeg",
          bytes: new TextEncoder().encode("expected"),
          declaredByteSize: 1,
        },
      ],
      [],
    );
    await expect(parseXOAuthCapture(wrongDeclaredSize, X_SOURCE_LIMITS)).rejects.toThrow(
      "size contradicts its ZIP entry",
    );

    const validLongFormTimeline = page([post({ id: "9" })]);
    const malformedLongFormCapture = await captureBytes(validLongFormTimeline, [], [], undefined, {
      ...validLongFormTimeline,
      data: [{ ...validLongFormTimeline.data[0], note_tweet: { text: 42 } }],
    });
    await expect(parseXOAuthCapture(malformedLongFormCapture, X_SOURCE_LIMITS)).rejects.toThrow(
      "note tweet text is invalid",
    );
  });
  test("fails closed on a capture whose entries are not parseable JSON", async () => {
    const malformed: ReadonlyArray<readonly [string, string]> = [
      ["{not json", '{"data":[]}'],
      ['{"format":"x-oauth-capture@1"}', "not json either"],
    ];
    for (const [manifestBody, timelineBody] of malformed) {
      const writer = new ZipWriter(new BlobWriter(X_OAUTH_CAPTURE_MIME));
      await writer.add(X_OAUTH_MANIFEST_PATH, new TextReader(manifestBody));
      await writer.add(X_OAUTH_TIMELINE_PATH, new TextReader(timelineBody));
      const bytes = new Uint8Array(await (await writer.close()).arrayBuffer());
      await expect(parseXOAuthCapture(bytes, X_SOURCE_LIMITS)).rejects.toThrow();
    }
  });

  test("fails closed on a capture that is missing a required entry", async () => {
    const writer = new ZipWriter(new BlobWriter(X_OAUTH_CAPTURE_MIME));
    await writer.add(X_OAUTH_MANIFEST_PATH, new TextReader("{}"));
    const bytes = new Uint8Array(await (await writer.close()).arrayBuffer());
    await expect(parseXOAuthCapture(bytes, X_SOURCE_LIMITS)).rejects.toThrow(
      "missing required entries",
    );
  });
});

function post(overrides: Partial<XApiPost> = {}): XApiPost {
  return {
    id: "100",
    text: "An original post",
    author_id: account.id,
    created_at: "2026-08-20T10:00:00.000Z",
    conversation_id: overrides.id ?? "100",
    lang: "en",
    possibly_sensitive: false,
    edit_history_tweet_ids: [overrides.id ?? "100"],
    ...overrides,
  };
}

function page(
  posts: readonly ReturnType<typeof post>[],
  media: readonly Record<string, unknown>[] = [],
): XApiTimelinePage {
  return {
    data: posts,
    includes: { media: media as never },
    meta: {
      result_count: posts.length,
      ...(posts[0] ? { newest_id: posts[0].id } : {}),
      ...(posts.at(-1) ? { oldest_id: posts.at(-1)!.id } : {}),
    },
  };
}

async function captureBytes(
  timeline: XApiTimelinePage,
  included: readonly {
    postId: string;
    attachmentIndex: number;
    mediaKey: string;
    sourceUrl: string;
    capturePath: string;
    kind: "image" | "video";
    mime: string;
    alt?: string;
    bytes: Uint8Array;
    declaredByteSize?: number;
  }[],
  omissions: XOAuthCaptureManifest["mediaOmissions"],
  replacementPayload?: Uint8Array,
  persistedTimeline: unknown = timeline,
): Promise<Uint8Array> {
  const normalized = normalizeXOAuthTimeline({
    account,
    timeline,
    limits: X_SOURCE_LIMITS,
    retrievedAt,
  });
  const manifest: XOAuthCaptureManifest = {
    format: X_OAUTH_CAPTURE_FORMAT,
    retrievedAt,
    account,
    limits: X_SOURCE_LIMITS,
    request: { maxResults: 100, exclude: ["replies", "retweets"] },
    ...(normalized.checkpoint ? { checkpoint: normalized.checkpoint } : {}),
    includedMedia: await Promise.all(
      included.map(async ({ bytes, declaredByteSize, ...media }) => ({
        ...media,
        byteSize: declaredByteSize ?? bytes.byteLength,
        contentHash: await sha256(bytes),
      })),
    ),
    mediaOmissions: omissions,
  };
  const writer = new ZipWriter(new BlobWriter(X_OAUTH_CAPTURE_MIME));
  await writer.add(X_OAUTH_MANIFEST_PATH, new TextReader(JSON.stringify(manifest)));
  await writer.add(X_OAUTH_TIMELINE_PATH, new TextReader(JSON.stringify(persistedTimeline)));
  for (const media of included) {
    await writer.add(media.capturePath, new Uint8ArrayReader(replacementPayload ?? media.bytes));
  }
  const blob = await writer.close();
  return new Uint8Array(await blob.arrayBuffer());
}
