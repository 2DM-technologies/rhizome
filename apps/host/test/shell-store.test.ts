import { expect, test } from "bun:test";

import {
  migrateShellPersistedState,
  nextOpenSurfaces,
  nextRecentSurfaces,
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

test("all page types share one deduplicated MRU list", () => {
  const ingest = { kind: "import" } as const;
  const app = { kind: "dmachine", name: "Geometry" } as const;
  let recent = nextRecentSurfaces([], VIBES);
  for (const surface of [VIBE_A, OBJECT, ingest, app]) {
    recent = nextRecentSurfaces(recent, surface);
  }
  expect(recent).toEqual([app, ingest, OBJECT, VIBE_A, VIBES]);
  expect(nextRecentSurfaces(recent, OBJECT)).toEqual([OBJECT, app, ingest, VIBE_A, VIBES]);
  expect(nextRecentSurfaces(recent, app)).toBe(recent);
});

test("surface identity includes the page kind when UUIDs match", () => {
  const object = { kind: "object", uuid: VIBE_A.uuid } as const;
  expect(nextRecentSurfaces([VIBE_A], object)).toEqual([object, VIBE_A]);
  expect(nextRecentSurfaces([OBJECT, VIBES, OBJECT], OBJECT)).toEqual([OBJECT, VIBES]);
});

test("superseded alpha sessions reset to current defaults", () => {
  for (let version = 0; version < SHELL_STORE_VERSION; version += 1) {
    expect(
      migrateShellPersistedState(
        { open: [VIBE_A, OBJECT, VIBE_B], defaultViewMode: "standard" },
        version,
      ),
    ).toEqual({
      open: [],
      recentSurfaces: [],
      lastFocusedSurface: null,
      defaultViewMode: "maximized",
    });
  }
});

test("current persisted state preserves mixed recents and explicitly retained windows", () => {
  const persisted = {
    open: [VIBES, OBJECT],
    recentSurfaces: [OBJECT, VIBES, VIBE_A],
    lastFocusedSurface: OBJECT,
    defaultViewMode: "standard",
  };

  expect(migrateShellPersistedState(persisted, SHELL_STORE_VERSION)).toBe(persisted);
});
