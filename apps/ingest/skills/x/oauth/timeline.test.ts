import { describe, expect, test } from "bun:test";

import { X_SOURCE_LIMITS } from "../definition.ts";
import { XApiClient } from "./client.ts";
import { normalizeXOAuthTimeline } from "./parser.ts";
import { parseXTimelinePage } from "./timeline.ts";

const account = { id: "42", handle: "example_user", name: "Example User" } as const;
const retrievedAt = "2026-08-21T12:00:00.000Z";
const endpoints = { apiBase: "https://api.x.test/2" } as const;

const validPost = {
  id: "100",
  text: "Truncated text…",
  author_id: "42",
  created_at: "2026-08-20T10:00:00.000Z",
  edit_history_tweet_ids: ["100"],
  note_tweet: {
    text: "Long 🔥 @Friend https://t.co/link",
    entities: {
      mentions: [{ start: 7, end: 14, username: "Friend" }],
      urls: [
        {
          start: 15,
          end: 32,
          url: "https://t.co/link",
          expanded_url: "https://example.test/long-form",
        },
      ],
    },
  },
} as const;

const validTimeline = {
  data: [validPost],
  includes: { media: [] },
  meta: { result_count: 1, newest_id: "100", oldest_id: "100" },
};

const malformedTimelineCorpus: readonly [string, unknown][] = [
  ["provider errors", { ...validTimeline, errors: [{ title: "partial response" }] }],
  ["contradictory result count", { ...validTimeline, meta: { result_count: 0 } }],
  [
    "non-string note text",
    { ...validTimeline, data: [{ ...validPost, note_tweet: { text: 42 } }] },
  ],
  [
    "malformed note entities",
    { ...validTimeline, data: [{ ...validPost, note_tweet: { text: "valid", entities: [] } }] },
  ],
  [
    "invalid note entity span",
    {
      ...validTimeline,
      data: [
        {
          ...validPost,
          note_tweet: {
            text: "@Friend",
            entities: { mentions: [{ start: 7, end: 0, username: "Friend" }] },
          },
        },
      ],
    },
  ],
  [
    "incomplete media variant",
    {
      ...validTimeline,
      includes: {
        media: [{ media_key: "video", type: "video", variants: [{ content_type: "video/mp4" }] }],
      },
    },
  ],
];

describe("X OAuth shared timeline contract", () => {
  test("projects long-form text and entities without retaining unknown provider fields", () => {
    const projected = parseXTimelinePage({
      ...validTimeline,
      data: [
        {
          ...validPost,
          arbitrary_provider_field: { secret: "discard me" },
          note_tweet: {
            ...validPost.note_tweet,
            arbitrary_note_field: "discard me too",
            entities: {
              ...validPost.note_tweet.entities,
              annotations: [{ normalized_text: "discard me" }],
            },
          },
        },
      ],
    });

    expect(projected.data[0]!.note_tweet).toEqual(validPost.note_tweet);
    expect(JSON.stringify(projected)).not.toContain("discard me");

    const normalized = normalizeXOAuthTimeline({
      account,
      timeline: projected,
      limits: X_SOURCE_LIMITS,
      retrievedAt,
    });
    expect(normalized.selection.posts[0]).toMatchObject({
      text: "Long 🔥 @Friend https://t.co/link",
      entities: {
        mentions: [{ start: 8, end: 15, username: "Friend" }],
        urls: [
          {
            start: 16,
            end: 33,
            url: "https://t.co/link",
            expanded_url: "https://example.test/long-form",
          },
        ],
      },
    });
  });

  test("rejects the same malformed corpus at the HTTP and capture-replay boundaries", async () => {
    for (const [label, timeline] of malformedTimelineCorpus) {
      expect(() => parseXTimelinePage(timeline), label).toThrow();
      expect(
        () =>
          normalizeXOAuthTimeline({
            account,
            timeline,
            limits: X_SOURCE_LIMITS,
            retrievedAt,
          }),
        `${label} during replay`,
      ).toThrow();

      const client = new XApiClient({
        endpoints,
        fetch: async () => Response.json(timeline),
      });
      await expect(
        client.getUserTimeline("access-token", account.id, {}, new AbortController().signal),
        `${label} at provider boundary`,
      ).rejects.toMatchObject({
        kind: label === "provider errors" ? "provider_rejected" : "invalid_response",
      });
    }
  });
});
