import { expect, test } from "bun:test";

import {
  migrateShellPersistedState,
  nextOpenSurfaces,
  nextRecentVibeUuids,
  SHELL_STORE_VERSION,
} from "../src/shell/store.ts";

const VIBES = { kind: "vibes" } as const;
const OBJECT = { kind: "object", uuid: "0198f2a1-a09b-76aa-95d8-fc5b55b41fd3" } as const;
const VIBE_A = { kind: "vibe", uuid: "0198f2a1-a09b-76aa-95d8-fc5b55b41fd4" } as const;
const VIBE_B = { kind: "vibe", uuid: "0198f2a1-a09b-76aa-95d8-fc5b55b41fd5" } as const;

test("opening a new surface replaces the current window by default", () => {
  expect(nextOpenSurfaces([VIBES], OBJECT)).toEqual([OBJECT]);
});

test("navigation can explicitly keep the current window open", () => {
  const open = nextOpenSurfaces([VIBES], OBJECT, { keepCurrentOpen: true });
  expect(open).toEqual([VIBES, OBJECT]);

  // Re-focusing an existing window is not a new open, so it must not close its peers.
  expect(nextOpenSurfaces(open, VIBES)).toBe(open);
});

test("opening Vibes records an uncapped, deduplicated most-recently-opened list", () => {
  const unchanged = [VIBE_B.uuid];
  expect(nextRecentVibeUuids(unchanged, OBJECT)).toBe(unchanged);

  const opened = nextRecentVibeUuids(unchanged, VIBE_A);
  expect(opened).toEqual([VIBE_A.uuid, VIBE_B.uuid]);
  expect(nextRecentVibeUuids(opened, VIBE_B)).toEqual([VIBE_B.uuid, VIBE_A.uuid]);
  expect(nextRecentVibeUuids([VIBE_A.uuid, VIBE_B.uuid, VIBE_A.uuid], VIBE_A)).toEqual([
    VIBE_A.uuid,
    VIBE_B.uuid,
  ]);
  expect(nextRecentVibeUuids(opened, VIBE_A)).toBe(opened);
});

test("version 0 windows seed Vibe recents before collapsing to the latest surface", () => {
  expect(
    migrateShellPersistedState(
      {
        open: [VIBE_A, VIBES, { kind: "broken" }, VIBE_B, OBJECT],
        defaultViewMode: "maximized",
      },
      0,
    ),
  ).toEqual({
    open: [OBJECT],
    recentVibeUuids: [VIBE_B.uuid, VIBE_A.uuid],
    defaultViewMode: "maximized",
  });
});

test("version 1 preserves explicitly retained windows and seeds Vibe recents", () => {
  expect(
    migrateShellPersistedState(
      {
        open: [VIBE_A, OBJECT, VIBE_B],
        defaultViewMode: "standard",
      },
      1,
    ),
  ).toEqual({
    open: [VIBE_A, OBJECT, VIBE_B],
    recentVibeUuids: [VIBE_B.uuid, VIBE_A.uuid],
    defaultViewMode: "standard",
  });
});

test("current persisted state preserves explicitly retained windows", () => {
  const persisted = {
    open: [VIBES, OBJECT],
    recentVibeUuids: [VIBE_A.uuid],
    defaultViewMode: "standard",
  };

  expect(migrateShellPersistedState(persisted, SHELL_STORE_VERSION)).toBe(persisted);
});

test("malformed legacy state migrates to safe defaults", () => {
  expect(migrateShellPersistedState({ open: "many", defaultViewMode: "huge" }, 0)).toEqual({
    open: [],
    recentVibeUuids: [],
    defaultViewMode: "standard",
  });
});
