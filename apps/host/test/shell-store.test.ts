import { expect, test } from "bun:test";

import {
  migrateShellPersistedState,
  nextOpenSurfaces,
  SHELL_STORE_VERSION,
} from "../src/shell/store.ts";

const VIBES = { kind: "vibes" } as const;
const OBJECT = { kind: "object", uuid: "0198f2a1-a09b-76aa-95d8-fc5b55b41fd3" } as const;

test("opening a new surface replaces the current window by default", () => {
  expect(nextOpenSurfaces([VIBES], OBJECT)).toEqual([OBJECT]);
});

test("navigation can explicitly keep the current window open", () => {
  const open = nextOpenSurfaces([VIBES], OBJECT, { keepCurrentOpen: true });
  expect(open).toEqual([VIBES, OBJECT]);

  // Re-focusing an existing window is not a new open, so it must not close its peers.
  expect(nextOpenSurfaces(open, VIBES)).toBe(open);
});

test("legacy persisted windows migrate to the most recently opened valid surface", () => {
  expect(
    migrateShellPersistedState(
      {
        open: [VIBES, { kind: "broken" }, OBJECT],
        defaultViewMode: "maximized",
      },
      0,
    ),
  ).toEqual({ open: [OBJECT], defaultViewMode: "maximized" });
});

test("current persisted state preserves explicitly retained windows", () => {
  const persisted = { open: [VIBES, OBJECT], defaultViewMode: "standard" };

  expect(migrateShellPersistedState(persisted, SHELL_STORE_VERSION)).toBe(persisted);
});

test("malformed legacy state migrates to safe defaults", () => {
  expect(migrateShellPersistedState({ open: "many", defaultViewMode: "huge" }, 0)).toEqual({
    open: [],
    defaultViewMode: "standard",
  });
});
