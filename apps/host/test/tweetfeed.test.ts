import { describe, expect, test } from "bun:test";
import type { MediaObject } from "@rnet/types";
import { httpLink, newestTweets, tweetTextParts } from "../src/surfaces/tweetfeed.ts";

describe("tweetfeed", () => {
  test("keeps exact Unicode, line breaks, and punctuation while linking safe URLs", () => {
    const text =
      "A ‘post’ 🌱\n\nSee (https://example.test/a_(b)).\nhttps://short.example/1! <script>hello</script>";
    const parts = tweetTextParts(text, {
      urls: [
        { url: "https://short.example/1", expanded_url: "https://example.test/article?x=1&y=2" },
      ],
    });
    expect(parts.map((part) => part.text).join("")).toBe(text);
    expect(parts.filter((part) => part.href).map((part) => part.href)).toEqual([
      "https://example.test/a_(b)",
      "https://example.test/article?x=1&y=2",
    ]);
    expect(tweetTextParts("", null)).toEqual([]);
  });

  test("ignores unsafe source destinations and malformed expansion data", () => {
    for (const value of [
      null,
      {},
      "not a URL",
      "javascript:alert(1)",
      "data:text/html,hi",
      "https://user:password@example.test/",
    ])
      expect(httpLink(value)).toBeUndefined();
    for (const entities of [
      null,
      [],
      { urls: "bad" },
      { urls: [null, { url: "https://example.test/", expanded_url: "javascript:alert(1)" }] },
    ]) {
      expect(tweetTextParts("https://example.test/", entities)).toEqual([
        { text: "https://example.test/", href: "https://example.test/" },
      ]);
    }
  });

  test("sorts newest first without mutating placement order; ties and undated posts stay stable", () => {
    const record = (published_at?: string) =>
      ({
        rnet_schema: "0.1",
        uri: "rnet://object/0198f2a1-b19c-77bb-a6e9-0d6c66c52ae3",
        owner: "rnet://id/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47",
        type: "tweet",
        elements: [],
        source: {
          ingest: { method: "authored", reproducible: false },
          origins: [],
          properties: { published_at },
        },
      }) satisfies MediaObject;
    const old = record("2026-01-01T00:00:00Z"),
      recent = record("2026-09-01T00:00:00Z");
    const objects = [old, record(), recent, recent, record("invalid")];
    expect(newestTweets(objects).map(({ position }) => position)).toEqual([2, 3, 0, 1, 4]);
    expect(objects[0]).toBe(old);
    expect(newestTweets([])).toEqual([]);
  });
});
