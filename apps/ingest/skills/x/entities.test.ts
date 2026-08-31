import { describe, expect, test } from "bun:test";

import { normalizeXEntities } from "./entities.ts";

describe("X structured entities", () => {
  test("deduplicates exact provider facts before enforcing non-overlap", () => {
    const mention = "@Friend";
    const hashtag = "#Topic";
    const cashtag = "$CASH";
    const url = "https://t.co/example";
    const text = `${mention} ${hashtag} ${cashtag} ${url}`;
    const repeated = <T>(value: T): [T, T, T] => [value, value, value];

    expect(
      normalizeXEntities(text, {
        mentions: repeated({
          username: "Friend",
          start: text.indexOf(mention),
          end: text.indexOf(mention) + mention.length,
        }),
        hashtags: repeated({
          tag: "Topic",
          start: text.indexOf(hashtag),
          end: text.indexOf(hashtag) + hashtag.length,
        }),
        cashtags: repeated({
          tag: "CASH",
          start: text.indexOf(cashtag),
          end: text.indexOf(cashtag) + cashtag.length,
        }),
        urls: repeated({
          url,
          expandedUrl: "https://example.test/article",
          start: text.indexOf(url),
          end: text.indexOf(url) + url.length,
        }),
      }),
    ).toEqual({
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
      urls: [
        {
          start: text.indexOf(url),
          end: text.indexOf(url) + url.length,
          url,
          expanded_url: "https://example.test/article",
        },
      ],
    });
  });

  test("continues to reject conflicting facts on the same exact-text span", () => {
    const text = "https://t.co/example";
    expect(() =>
      normalizeXEntities(text, {
        urls: [
          {
            url: text,
            expandedUrl: "https://example.test/first",
            start: 0,
            end: text.length,
          },
          {
            url: text,
            expandedUrl: "https://example.test/second",
            start: 0,
            end: text.length,
          },
        ],
      }),
    ).toThrow("X structured entities contain overlapping exact-text spans");
  });
});
