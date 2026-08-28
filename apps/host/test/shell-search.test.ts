import { expect, test } from "bun:test";

import { searchShell } from "../src/shell/search.ts";
import { labelOf, locationOf, pathOf, surfaceFromPath, viewModeOf } from "../src/shell/surfaces.ts";

const VIBE_UUID = "0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47";

test("search combines commands, retained surfaces, and loaded Vibe titles", () => {
  const results = searchShell(
    "",
    [{ kind: "object", uuid: "0198f2a1-7c3d-7e4b-9f21-000000000123" }],
    [{ uuid: VIBE_UUID, title: "Spending" }],
  );

  expect(results.map(({ group, label }) => [group, label])).toEqual([
    ["Commands", "Open Vibes"],
    ["Commands", "Show Desktop"],
    ["Open surfaces", "Object …000123"],
    ["Vibes", "Spending"],
  ]);
  expect(searchShell("spend", [], [{ uuid: VIBE_UUID, title: "Spending" }])[0]?.action).toEqual({
    kind: "open",
    surface: { kind: "vibe", uuid: VIBE_UUID },
  });
});

test("an open Vibe uses its loaded title and is not duplicated", () => {
  const vibe = { kind: "vibe", uuid: VIBE_UUID } as const;
  const results = searchShell("spending", [vibe], [{ uuid: VIBE_UUID, title: "Spending" }]);

  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ group: "Open surfaces", label: "Spending" });
  expect(labelOf(vibe, new Map([[VIBE_UUID, "Spending"]]))).toBe("Spending");
});

test("surface paths round-trip through the canonical URL parser", () => {
  const vibe = { kind: "vibe", uuid: VIBE_UUID } as const;

  expect(pathOf(vibe)).toBe(`/vibes/${VIBE_UUID}`);
  expect(surfaceFromPath(pathOf(vibe))).toEqual(vibe);
  expect(viewModeOf("")).toBe("standard");
  expect(viewModeOf("?mode=maximized")).toBe("maximized");
  expect(viewModeOf("?mode=unknown")).toBe("standard");
  expect(locationOf(vibe, "maximized")).toBe(`/vibes/${VIBE_UUID}?mode=maximized`);
  expect(surfaceFromPath("/")).toBeNull();
});
