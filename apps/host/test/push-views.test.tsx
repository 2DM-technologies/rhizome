import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MediaElement, MediaObject, Vibe } from "@rnet/types";
import { storeTaskKey, type VIBE_VIEWS } from "@rhizome/store-contract";

import { api } from "../src/api/client.ts";
import { PUSH_TASKS } from "../src/api/generated/push-tasks.ts";
import { InferredVibeView } from "../src/surfaces/vibe-view/InferredVibeView.tsx";
import { resolveVibeView } from "../src/surfaces/vibe-view/utils.ts";

import { VibeOverview } from "../src/surfaces/VibeOverview.tsx";

const owner = "rnet://id/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47";
const id = (index: number) => `0198f2a1-7c3d-7e4b-9f21-${String(index).padStart(12, "0")}`;
function object(index: number, amount: number): MediaObject {
  return {
    rnet_schema: "0.1",
    uri: `rnet://object/${id(index)}`,
    owner,
    type: "garden.plant",
    elements: [],
    source: {
      ingest: { method: "authored", reproducible: false },
      origins: ["rnet://client/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b48"],
      properties: { title: `Source ${index}`, amount, nested: { "a/b~c": "Escaped pointer" } },
    },
    inferred: {
      [storeTaskKey(PUSH_TASKS.object["display-name"].name)]: {
        model: "mock/rhizome",
        properties: { display_name: `Object ${index}` },
      },
    },
  };
}
function vibe(view?: (typeof VIBE_VIEWS)[number], config: object = {}): Vibe {
  return {
    rnet_schema: "0.1",
    uri: `rnet://vibe/${id(100)}`,
    owner,
    title: "Test Vibe",
    created_at: "2026-09-10T12:00:00Z",
    updated_at: "2026-09-10T12:00:00Z",
    objects: [],
    grants: [],
    inferred: view
      ? {
          [storeTaskKey(PUSH_TASKS.vibe["vibe-view"].name)]: {
            model: "mock/rhizome",
            properties: { view, config },
          },
        }
      : {},
  };
}
function render(
  document: Vibe,
  objects: MediaObject[],
  elements: MediaElement[] = [],
  canRemove = false,
) {
  const client = new QueryClient();
  for (const element of elements)
    client.setQueryData(
      api.queryOptions("get", "/rnet/v0/elements/{id}", {
        params: { path: { id: element.uri.split("/").at(-1)! } },
      }).queryKey,
      element,
    );
  try {
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <InferredVibeView
          vibe={document}
          objects={objects}
          openObject={() => undefined}
          {...(canRemove ? { removeObject: () => undefined, removePending: true } : {})}
        />
      </QueryClientProvider>,
    );
  } finally {
    client.clear();
  }
}

describe("inferred Vibe surfaces", () => {
  test("tweet-only Vibes default to the feed; mixed and empty collections keep other views", () => {
    const tweet = { ...object(1, 2), type: "tweet" };
    for (const document of [
      vibe(),
      vibe("tweetfeed"),
      vibe("datatable", { columns: [], sort: null }),
    ]) {
      expect(resolveVibeView(document, [tweet])).toBe("tweetfeed");
      const markup = render(document, [tweet, tweet], [], true);
      expect(markup.match(/data-tweet-object=/g)).toHaveLength(2);
      expect(markup).toContain('data-vibe-view="tweetfeed"');
      expect(markup).toContain(`href="/objects/${id(1)}"`);
      expect(markup).toContain('disabled=""');
    }
    expect(resolveVibeView(vibe("tweetfeed"), [])).toBeUndefined();
    expect(resolveVibeView(vibe("tweetfeed"), [tweet, object(2, 3)])).toBeUndefined();
    expect(
      resolveVibeView(vibe("simplelist", { subtitle_pointer: null }), [tweet, object(2, 3)]),
    ).toBe("simplelist");
    const imported = {
      ...tweet,
      source: {
        ...tweet.source,
        ingest: { method: "parser" as const, reproducible: true, skill: "test@1" },
      },
    };
    expect(render(vibe(), [imported], [], true)).not.toContain(">Remove</button>");
  });

  test("summarize renders independently of an inferred view", () => {
    const document = vibe();
    document.inferred = {
      [storeTaskKey(PUSH_TASKS.vibe.summarize.name)]: {
        model: "mock/rhizome",
        properties: { summary: "A collection of garden plans.", tags: ["garden"], confidence: 0.8 },
      },
    };
    const markup = renderToStaticMarkup(<VibeOverview vibe={document} />);
    expect(markup).toContain("A collection of garden plans.");
    expect(markup).not.toContain("data-vibe-view");
  });

  test("simplelist uses inferred labels, tolerates missing pointers, and preserves placements", () => {
    const record = object(1, 2);
    const noSubtitle = render(vibe("simplelist", { subtitle_pointer: null }), [record, record]);
    expect(noSubtitle.match(/Object 1/g)).toHaveLength(2);
    expect(noSubtitle).not.toContain("Source 1");
    const missing = render(vibe("simplelist", { subtitle_pointer: "/user/properties/missing" }), [
      record,
    ]);
    expect(missing).toContain("—");
    const fallback = render(vibe("simplelist", { subtitle_pointer: null }), [
      { ...record, inferred: {} },
    ]);
    expect(fallback).toContain(`garden.plant ${id(1)}`);
  });

  test("datatable resolves escaped and absent pointers and sorts numeric values in both directions", () => {
    const rows = [object(1, 10), object(2, 2)];
    const columns = [
      "/source/properties/amount",
      "/source/properties/nested/a~1b~0c",
      "/user/properties/missing",
    ];
    for (const direction of ["asc", "desc"] as const) {
      const markup = render(
        vibe("datatable", { columns, sort: { pointer: columns[0], direction } }),
        rows,
      );
      expect(markup.match(/Escaped pointer/g)).toHaveLength(2);
      expect(markup.match(/—/g)).toHaveLength(2);
      expect(markup.indexOf("Object 2") < markup.indexOf("Object 1")).toBe(direction === "asc");
    }
    const unsorted = render(vibe("datatable", { columns, sort: null }), rows);
    expect(unsorted.indexOf("Object 1")).toBeLessThan(unsorted.indexOf("Object 2"));
    expect(rows.map((record) => record.source.properties.amount)).toEqual([10, 2]);
  });

  test("mediaboard uses the M2 media card with inferred names and configured captions", () => {
    const record = object(1, 2);
    const elements = ["image", "text", "image"].map((kind, index): MediaElement => ({
      rnet_schema: "0.1",
      uri: `rnet://element/${id(200 + index)}`,
      owner,
      kind: kind as "image" | "text",
      mime: kind === "image" ? "image/png" : "text/plain",
      alt: `Element ${index}`,
      content_hash: `sha256:${"0".repeat(64)}`,
      byte_size: 1,
      bytes: `https://rhizome.test/rnet/v0/elements/${id(200 + index)}/bytes`,
      created_at: "2026-09-10T12:00:00Z",
      updated_at: "2026-09-10T12:00:00Z",
    }));
    record.elements = elements.map(({ uri }) => ({ uri }));
    const markup = render(
      vibe("mediaboard", { caption_pointer: "/source/properties/title" }),
      [record],
      elements,
    );
    expect(markup.match(/data-media-object-card/g)).toHaveLength(1);
    expect(markup).toContain("image/png · ");
    expect(markup).toContain("3 elements");
    expect(markup).toContain("Object 1");
    expect(markup).toContain("Source 1");
  });

  test("each view retains opening and owner removal of authored objects", () => {
    for (const document of [
      vibe("simplelist", { subtitle_pointer: null }),
      vibe("datatable", { columns: ["/source/properties/amount"], sort: null }),
      vibe("mediaboard", { caption_pointer: null }),
    ]) {
      const markup = render(document, [object(1, 2)], [], true);
      expect(markup).toContain(">Remove</button>");
      expect(markup).toContain('disabled=""');
      expect(render(document, [object(1, 2)])).not.toContain(">Remove</button>");
      const imported = object(2, 3);
      imported.source.ingest = { method: "parser", reproducible: true, skill: "test@1" };
      expect(render(document, [imported], [], true)).not.toContain(">Remove</button>");
      expect(markup).toContain(`aria-label="Open object rnet://object/${id(1)}"`);
      expect(markup).toContain(`aria-label="Remove rnet://object/${id(1)} from Vibe"`);
    }
  });
});
