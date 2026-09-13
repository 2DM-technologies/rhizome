import { describe, expect, test } from "bun:test";

import { mediaObjectDisplayName } from "../src/mediaObjectDisplayName.ts";

function objectWithProperties(properties: Record<string, unknown>, type = "note") {
  return { type, source: { properties } };
}

describe("media object display names", () => {
  test("prefers the generated display name", () => {
    expect(
      mediaObjectDisplayName({
        ...objectWithProperties({ title: "Source title" }),
        inferred: { "rhizome:display-name": { properties: { display_name: "Inferred title" } } },
      }),
    ).toBe("Inferred title");
  });
  test("uses the established source property precedence", () => {
    const properties = {
      title: "Title",
      name: "Name",
      raw_description: "Raw description",
      description: "Description",
    };

    expect(mediaObjectDisplayName(objectWithProperties(properties))).toBe("Title");
    expect(mediaObjectDisplayName(objectWithProperties({ ...properties, title: " \n\t " }))).toBe(
      "Name",
    );
    expect(
      mediaObjectDisplayName(objectWithProperties({ ...properties, title: null, name: undefined })),
    ).toBe("Raw description");
    expect(
      mediaObjectDisplayName(
        objectWithProperties({
          ...properties,
          title: null,
          name: undefined,
          raw_description: false,
        }),
      ),
    ).toBe("Description");
  });

  test("normalizes whitespace in property names", () => {
    expect(
      mediaObjectDisplayName(objectWithProperties({ title: "  A\n\t property\u00a0 title  " })),
    ).toBe("A property title");
  });

  test("uses an author handle and deterministic publication date after explicit names", () => {
    const tweet = objectWithProperties(
      { author_handle: "@noah_putnam", published_at: "2026-08-11T05:33:00-04:00" },
      "tweet",
    );

    expect(mediaObjectDisplayName(tweet)).toBe("@noah_putnam - Aug 11, 2026");
    expect(
      mediaObjectDisplayName(
        objectWithProperties({ ...tweet.source.properties, title: "Post" }, "tweet"),
      ),
    ).toBe("Post");
    expect(
      mediaObjectDisplayName(
        objectWithProperties({ author_handle: "noah_putnam", published_at: "not-a-date" }, "tweet"),
      ),
    ).toBe("Untitled tweet");
  });

  test("bounds long names by Unicode code point without splitting surrogate pairs", () => {
    const displayName = mediaObjectDisplayName(
      objectWithProperties({ title: `${"a".repeat(118)}🤔bc` }),
    );

    expect(displayName).toBe(`${"a".repeat(118)}🤔…`);
    expect(Array.from(displayName)).toHaveLength(120);
    expect(displayName).not.toMatch(/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/u);
  });

  test("uses generic humanized and transaction fallbacks", () => {
    expect(mediaObjectDisplayName(objectWithProperties({}, "photo_album"))).toBe(
      "Untitled photo album",
    );
    expect(mediaObjectDisplayName(objectWithProperties({}, "transaction"))).toBe("Transaction");
    expect(mediaObjectDisplayName({ source: { properties: null }, type: " \t " })).toBe(
      "Untitled media object",
    );
  });
});
