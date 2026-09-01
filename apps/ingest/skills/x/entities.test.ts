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

  test("reuses one scalar offset map at the maximum text and entity bounds", () => {
    const emojiCount = 495_000;
    const tokens = Array.from({ length: 1_024 }, (_, index) => `#tag${index}`);
    const suffix = ` ${tokens.join(" ")}`;
    const text = `${"🔥".repeat(emojiCount)}${suffix}`;
    let suffixOffset = 1;
    const hashtags = tokens.map((token) => {
      const start = emojiCount + suffixOffset;
      suffixOffset += token.length + 1;
      return { tag: token.slice(1), start, end: start + token.length };
    });

    expect(text.length).toBeLessThanOrEqual(1_000_000);
    expect(normalizeXEntities(text, { hashtags })?.hashtags).toHaveLength(1_024);
  });

  test("bounds hostile offset-less matching work", () => {
    const text = "a".repeat(1_000_000);
    const urls = Array.from({ length: 1_024 }, (_, index) => ({ url: `a${index}` }));
    expect(() => normalizeXEntities(text, { urls })).toThrow("matching exceeds its work limit");
  });

  test("does not match shorter offset-less handles or tags inside longer tokens", () => {
    const text = "@foobar @foo #tagged #tag $CASHFLOW $CASH";
    expect(
      normalizeXEntities(text, {
        mentions: [{ username: "foobar" }, { username: "foo" }],
        hashtags: [{ tag: "tagged" }, { tag: "tag" }],
        cashtags: [{ tag: "CASHFLOW" }, { tag: "CASH" }],
      }),
    ).toEqual({
      mentions: [
        { start: 0, end: 7, username: "foobar" },
        { start: 8, end: 12, username: "foo" },
      ],
      hashtags: [
        { start: 13, end: 20, tag: "tagged" },
        { start: 21, end: 25, tag: "tag" },
      ],
      cashtags: [
        { start: 26, end: 35, tag: "CASHFLOW" },
        { start: 36, end: 41, tag: "CASH" },
      ],
    });
  });
});
