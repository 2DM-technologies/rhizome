import { expect, test } from "bun:test";

import {
  migrateShellPersistedState,
  nextOpenSurfaces,
  nextRecentVibeSurfaces,
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

test("the Vibes index and individual Vibes share one deduplicated MRU list", () => {
  const unchanged = [VIBE_B];
  expect(nextRecentVibeSurfaces(unchanged, OBJECT)).toBe(unchanged);

  const openedIndex = nextRecentVibeSurfaces(unchanged, VIBES);
  expect(openedIndex).toEqual([VIBES, VIBE_B]);

  const openedVibe = nextRecentVibeSurfaces(openedIndex, VIBE_A);
  expect(openedVibe).toEqual([VIBE_A, VIBES, VIBE_B]);
  expect(nextRecentVibeSurfaces(openedVibe, VIBE_B)).toEqual([VIBE_B, VIBE_A, VIBES]);
  expect(nextRecentVibeSurfaces([VIBE_A, VIBES, VIBE_B, VIBE_A], VIBE_A)).toEqual([
    VIBE_A,
    VIBES,
    VIBE_B,
  ]);
  expect(nextRecentVibeSurfaces(openedVibe, VIBE_A)).toBe(openedVibe);
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
    recentVibeSurfaces: [VIBE_B, VIBES, VIBE_A],
    lastFocusedSurface: OBJECT,
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
    recentVibeSurfaces: [VIBE_B, VIBE_A],
    lastFocusedSurface: VIBE_B,
    defaultViewMode: "standard",
  });
});

test("version 2 migrates UUID recents and an open Vibes index into one MRU list", () => {
  expect(
    migrateShellPersistedState(
      {
        open: [VIBES, VIBE_B],
        recentVibeUuids: [VIBE_A.uuid, VIBE_B.uuid, VIBE_A.uuid],
        defaultViewMode: "standard",
      },
      2,
    ),
  ).toEqual({
    open: [VIBES, VIBE_B],
    recentVibeSurfaces: [VIBE_B, VIBES, VIBE_A],
    lastFocusedSurface: VIBE_B,
    defaultViewMode: "standard",
  });
});

test("current persisted state preserves explicitly retained windows", () => {
  const persisted = {
    open: [VIBES, OBJECT],
    recentVibeSurfaces: [VIBES, VIBE_A],
    lastFocusedSurface: OBJECT,
    defaultViewMode: "standard",
  };

  expect(migrateShellPersistedState(persisted, SHELL_STORE_VERSION)).toBe(persisted);
});

test("malformed legacy state migrates to safe defaults", () => {
  expect(migrateShellPersistedState({ open: "many", defaultViewMode: "huge" }, 0)).toEqual({
    open: [],
    recentVibeSurfaces: [],
    lastFocusedSurface: null,
    defaultViewMode: "standard",
  });
});

test("version 3 seeds the desktop return target from the newest open window", () => {
  expect(
    migrateShellPersistedState(
      {
        open: [VIBES, OBJECT],
        recentVibeSurfaces: [VIBES],
        defaultViewMode: "maximized",
      },
      3,
    ),
  ).toEqual({
    open: [VIBES, OBJECT],
    recentVibeSurfaces: [VIBES],
    lastFocusedSurface: OBJECT,
    defaultViewMode: "maximized",
  });
});
