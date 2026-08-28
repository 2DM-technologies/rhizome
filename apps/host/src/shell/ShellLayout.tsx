import { useMemo, useRef, useState, type KeyboardEvent } from "react";

import appMark from "../assets/brand/app-mark.png";
import orb1 from "../assets/orbs/orb-1-44.png";
import orb2 from "../assets/orbs/orb-2-44.png";
import orb3 from "../assets/orbs/orb-3-44.png";
import orb4 from "../assets/orbs/orb-4-44.png";
import orbHome from "../assets/orbs/orb-home-48.png";
import { uuidOf } from "../api/uris.ts";
import { useVibes } from "../queries/index.ts";
import { useSession } from "../session/session.ts";
import {
  Desktop,
  Dock,
  DockApp,
  DockDivider,
  DockTray,
  LauncherItem,
  LauncherPanel,
  SearchField,
  VibeOrb,
} from "../ui/index.ts";
import { SurfaceLayer } from "./SurfaceLayer.tsx";
import { useEnsureSurfaceOpen, useFocusedSurface, useSurfaceNavigation } from "./focus.ts";
import { searchShell, SHELL_SEARCH_GROUPS, type ShellSearchResult } from "./search.ts";
import { useOpenSurfaces, useShellStore } from "./store.ts";
import { labelOf, surfaceId, type Surface } from "./surfaces.ts";

/**
 * There is no Figma spec for host surfaces in the dock — the mockups only show dMachine apps —
 * so their marks are stand-ins, picked deterministically per surface so a window keeps the
 * same face across a session.
 */
const STAND_IN_ORBS = [orb1, orb2, orb3, orb4];

function markFor(surface: Surface): string {
  if (surface.kind === "dmachine") return appMark;
  const id = surfaceId(surface);
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) % 997;
  return STAND_IN_ORBS[hash % STAND_IN_ORBS.length] as string;
}

/**
 * The persistent shell. Nothing here unmounts on navigation — that is the entire point. The
 * dock, the desktop, and the surface layer live above the router's control, and the URL only
 * decides which surface inside them is focused.
 */
export function ShellLayout() {
  const { surface: focused, mode } = useFocusedSurface();
  useEnsureSurfaceOpen(focused);

  const open = useOpenSurfaces();
  const launcherOpen = useShellStore((state) => state.launcherOpen);
  const setLauncherOpen = useShellStore((state) => state.setLauncherOpen);
  const navigation = useSurfaceNavigation();
  const session = useSession();
  const vibes = useVibes();
  const [query, setQuery] = useState("");
  const launcherTrigger = useRef<HTMLButtonElement>(null);

  const focusedId = focused ? surfaceId(focused) : null;
  const background = open.filter((surface) => surfaceId(surface) !== focusedId);
  const loadedVibes = useMemo(
    () =>
      (vibes.data ?? []).map((vibe) => ({
        uuid: uuidOf(vibe.uri),
        title: vibe.title,
      })),
    [vibes.data],
  );
  const vibeTitles = useMemo(
    () => new Map(loadedVibes.map((vibe) => [vibe.uuid, vibe.title])),
    [loadedVibes],
  );
  const results = useMemo(() => searchShell(query, open, loadedVibes), [loadedVibes, open, query]);

  function dismissLauncher({ restoreFocus = false } = {}) {
    setLauncherOpen(false);
    setQuery("");
    if (restoreFocus) queueMicrotask(() => launcherTrigger.current?.focus());
  }

  function selectResult(result: ShellSearchResult) {
    dismissLauncher();
    if (result.action.kind === "home") navigation.home();
    else navigation.open(result.action.surface);
  }

  function handleLauncherKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && results[0]) {
      event.preventDefault();
      selectResult(results[0]);
    }
  }

  const launcherSections = SHELL_SEARCH_GROUPS.flatMap((group) => {
    const groupResults = results.filter((result) => result.group === group);
    return groupResults.length === 0
      ? []
      : [
          {
            title: group,
            items: groupResults.map((result) => (
              <LauncherItem
                key={result.id}
                label={result.label}
                icon={result.group === "Commands" ? "⌘" : "◉"}
                onSelect={() => selectResult(result)}
              />
            )),
          },
        ];
  });

  return (
    <Desktop
      dock={
        <Dock
          leading={
            <button
              type="button"
              aria-label="Home"
              onClick={() => navigation.open({ kind: "vibes" })}
              className="rounded-full transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <VibeOrb src={orbHome} size="lg" alt="" />
              <span className="sr-only">{session.data?.user.handle ?? "Home"}</span>
            </button>
          }
          apps={
            focused ? (
              <DockApp
                name={`${labelOf(focused, vibeTitles)} — ${mode === "maximized" ? "restore standard window" : "maximize window"}`}
                src={markFor(focused)}
                state="active"
                onOpen={navigation.toggleMaximized}
              />
            ) : null
          }
          tray={
            <DockTray>
              <div className="flex min-w-0 shrink items-center gap-5 overflow-hidden">
                {background.map((surface) => (
                  <DockApp
                    key={surfaceId(surface)}
                    name={labelOf(surface, vibeTitles)}
                    src={markFor(surface)}
                    onOpen={() => navigation.open(surface)}
                  />
                ))}
              </div>
              <DockDivider />
              <button
                ref={launcherTrigger}
                type="button"
                aria-label="Start something new"
                aria-expanded={launcherOpen}
                onClick={() => (launcherOpen ? dismissLauncher() : setLauncherOpen(true))}
                className="grid size-11 shrink-0 place-items-center rounded-pill bg-pill text-2xl leading-none text-on-pill transition-colors hover:text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <span aria-hidden>+</span>
              </button>
              <div
                className="relative h-12 shrink-0 transition-[width] duration-300 ease-out"
                style={{ width: launcherOpen ? 328 : 240 }}
              >
                {launcherOpen ? (
                  <div className="absolute bottom-[-8px] left-0 w-82">
                    <LauncherPanel
                      query={query}
                      onQueryChange={setQuery}
                      onInputKeyDown={handleLauncherKeyDown}
                      onDismiss={() => dismissLauncher({ restoreFocus: true })}
                      sections={
                        launcherSections.length > 0
                          ? launcherSections
                          : [
                              {
                                title: "No results",
                                items: (
                                  <span className="text-body text-on-pill">
                                    Try a command, open surface, or Vibe title.
                                  </span>
                                ),
                              },
                            ]
                      }
                    />
                  </div>
                ) : (
                  <SearchField
                    className="w-full"
                    aria-label="Search everything"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onFocus={() => setLauncherOpen(true)}
                  />
                )}
              </div>
            </DockTray>
          }
        />
      }
    >
      <SurfaceLayer />
    </Desktop>
  );
}
