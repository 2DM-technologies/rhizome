import { describe, expect, test } from "bun:test";
import { VIBE_VIEWS } from "@rhizome/store-contract";
import { jsonSchema } from "../src/routes/contracts.ts";
import type { VibeContext } from "../src/push/context.ts";
import { vibeView } from "../src/push/tasks/vibe/vibe_view/manifest.ts";
import { chooseVibeView, validateVibeViewOutput } from "../src/push/tasks/vibe/vibe_view/rules.ts";

const pointer = (value: string) => ({ pointer: value, kind: "string" as const });
const context = (
  types: VibeContext["types"],
  elements: VibeContext["elements"] = [],
): VibeContext => ({
  title: "Test",
  summary: null,
  objects: types.reduce((sum, type) => sum + type.count, 0),
  types,
  elements,
});
const type = (
  name: string,
  pointers: string[],
  count = 1,
  elements: VibeContext["types"][number]["elements"] = [],
) => ({ type: name, count, pointers: pointers.map(pointer), elements });

function expectValid(output: Record<string, unknown>, input: VibeContext) {
  expect(jsonSchema(vibeView.outputSchema).validate(output).ok).toBe(true);
  expect(validateVibeViewOutput(output, input)).toBe(true);
}

describe("vibe_view", () => {
  test("tweet-only Vibes choose tweetfeed before pointer and media rules", () => {
    for (const input of [
      context([type("tweet", [])]),
      context([type("tweet", ["/source/properties/published_at"])]),
      context(
        [
          type("tweet", [], 2, [
            { kind: "text", objects: 2 },
            { kind: "image", objects: 1 },
          ]),
        ],
        [
          { kind: "text", count: 2 },
          { kind: "image", count: 1 },
        ],
      ),
    ]) {
      const output = chooseVibeView(input)!;
      expect(output).toEqual({ view: "tweetfeed", config: {} });
      expectValid(output, input);
    }
  });

  test("tweetfeed requires a nonempty, complete tweet-only context and empty config", () => {
    const output = { view: "tweetfeed", config: {} };
    for (const input of [
      context([]),
      context([type("tweet", [], 0)]),
      context([type("tweet", []), type("note", [])]),
      { ...context([type("tweet", [])]), objects: 2 },
    ]) {
      expect(chooseVibeView(input)?.view).not.toBe("tweetfeed");
      expect(validateVibeViewOutput(output, input)).toBe(false);
    }
    const tweets = context([type("tweet", [])]);
    for (const config of [
      null,
      [],
      { subtitle_pointer: null },
      { caption_pointer: null },
      { extra: true },
    ])
      expect(validateVibeViewOutput({ view: "tweetfeed", config }, tweets)).toBe(false);
  });

  test("schema discriminator stays aligned with the contract views", () => {
    const schema = vibeView.outputSchema as {
      properties: { view: { enum: string[] } };
    };
    expect(schema.properties.view.enum).toEqual([...VIBE_VIEWS]);
  });

  test("uses simplelist without a model call when no pointers are observed", () => {
    const input = context([type("garden.empty", [])]);
    const output = chooseVibeView(input)!;
    expect(output).toEqual({ view: "simplelist", config: { subtitle_pointer: null } });
    expectValid(output, input);
    const imageOnly = context(
      [type("arena.block", [], 1, [{ kind: "image", objects: 1 }])],
      [{ kind: "image", count: 1 }],
    );
    const fallback = chooseVibeView(imageOnly)!;
    expect(fallback).toEqual({ view: "simplelist", config: { subtitle_pointer: null } });
    expectValid(fallback, imageOnly);
  });

  test("uses canonical transaction columns in order and sorts only when posted_at exists", () => {
    const withoutDate = context([
      type("transaction", ["/source/properties/currency", "/source/properties/amount"]),
    ]);
    const output = chooseVibeView(withoutDate)!;
    expect(output).toEqual({
      view: "datatable",
      config: {
        columns: ["/source/properties/amount", "/source/properties/currency"],
        sort: null,
      },
    });
    expectValid(output, withoutDate);

    const withDate = context([
      type("transaction", ["/source/properties/amount", "/source/properties/posted_at"]),
    ]);
    const datedOutput = chooseVibeView(withDate)!;
    expect(datedOutput).toEqual({
      view: "datatable",
      config: {
        columns: ["/source/properties/posted_at", "/source/properties/amount"],
        sort: { pointer: "/source/properties/posted_at", direction: "desc" },
      },
    });
    expectValid(datedOutput, withDate);
  });

  test("does not use a rule for a transaction with only a noncanonical pointer and an element", () => {
    expect(
      chooseVibeView(
        context(
          [type("transaction", ["/source/properties/memo"], 1, [{ kind: "audio", objects: 1 }])],
          [{ kind: "audio", count: 1 }],
        ),
      ),
    ).toBeUndefined();
  });

  test("requires every arena or Pinterest object to have an image", () => {
    const title = "/source/properties/title";
    const complete = context(
      [type("arena.block", [title], 2, [{ kind: "image", objects: 2 }])],
      [{ kind: "image", count: 2 }],
    );
    const output = chooseVibeView(complete)!;
    expect(output).toEqual({ view: "mediaboard", config: { caption_pointer: title } });
    expectValid(output, complete);
    const pinterest = context(
      [
        type("pinterest.pin", ["/source/properties/description"], 1, [
          { kind: "image", objects: 1 },
        ]),
      ],
      [{ kind: "image", count: 1 }],
    );
    const withoutCaption = chooseVibeView(pinterest)!;
    expect(withoutCaption).toEqual({ view: "mediaboard", config: { caption_pointer: null } });
    expectValid(withoutCaption, pinterest);

    const incomplete = context(
      [type("arena.block", [title], 2, [{ kind: "image", objects: 1 }])],
      [{ kind: "image", count: 1 }],
    );
    expect(chooseVibeView(incomplete)).toBeUndefined();

    const mixed = context(
      [
        type("arena.block", [title], 1, [{ kind: "image", objects: 1 }]),
        type("pinterest.pin", [title], 1, [{ kind: "image", objects: 1 }]),
      ],
      [{ kind: "image", count: 2 }],
    );
    expect(chooseVibeView(mixed)).toBeUndefined();
  });

  test("uses the first eight observed pointers for one element-free type", () => {
    const pointers = Array.from({ length: 10 }, (_, index) => `/source/properties/p${index}`);
    const input = context([type("garden.plant", pointers)]);
    const output = chooseVibeView(input)!;
    expect(output).toEqual({
      view: "datatable",
      config: { columns: pointers.slice(0, 8), sort: null },
    });
    expectValid(output, input);
  });

  test("post-check rejects a mismatched branch or an unobserved pointer", () => {
    const input = context(
      [type("mixed", ["/source/properties/title"])],
      [{ kind: "image", count: 1 }],
    );
    expect(
      validateVibeViewOutput(
        { view: "simplelist", config: { caption_pointer: "/source/properties/title" } },
        input,
      ),
    ).toBe(false);
    expect(
      validateVibeViewOutput(
        { view: "simplelist", config: { subtitle_pointer: "/source/properties/missing" } },
        input,
      ),
    ).toBe(false);
    expect(
      validateVibeViewOutput(
        { view: "simplelist", config: { subtitle_pointer: "/source/properties/title" } },
        input,
      ),
    ).toBe(true);
    for (const output of [
      { view: "datatable", config: { subtitle_pointer: null } },
      { view: "mediaboard", config: { columns: ["/source/properties/title"], sort: null } },
      { view: "simplelist", config: { caption_pointer: null } },
      {
        view: "datatable",
        config: { columns: ["/source/properties/missing"], sort: null },
      },
      {
        view: "datatable",
        config: {
          columns: ["/source/properties/title"],
          sort: { pointer: "/source/properties/missing", direction: "asc" },
        },
      },
      { view: "mediaboard", config: { caption_pointer: "/source/properties/missing" } },
    ])
      expect(validateVibeViewOutput(output, input)).toBe(false);
  });
});
