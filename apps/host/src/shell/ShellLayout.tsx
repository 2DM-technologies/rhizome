import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEventHandler,
} from "react";

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
const RUNNING_APP_SIZE = 44;
const RUNNING_APP_GAP = 20;
const HOME_SURFACE = { kind: "vibes" } satisfies Surface;

function markFor(surface: Surface): string {
  if (surface.kind === "dmachine") return appMark;
  const id = surfaceId(surface);
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) % 997;
  return STAND_IN_ORBS[hash % STAND_IN_ORBS.length] as string;
}

interface RunningSurfaceDockAppProps {
  name: string;
  src: string;
  onOpen: MouseEventHandler<HTMLButtonElement>;
}

function RunningSurfaceDockApp({ name, src, onOpen }: RunningSurfaceDockAppProps) {
  return <DockApp name={name} src={src} onOpen={onOpen} />;
}

/**
 * The persistent shell. Nothing here unmounts on navigation — that is the entire point. The
 * dock, the desktop, and the surface layer live above the router's control, and the URL only
 * decides which surface inside them is focused.
 */
export function ShellLayout() {
  const { surface: focused, mode } = useFocusedSurface();
  useEnsureSurfaceOpen(focused, mode);

  const open = useOpenSurfaces();
  const defaultViewMode = useShellStore((state) => state.defaultViewMode);
  const launcherOpen = useShellStore((state) => state.launcherOpen);
  const setLauncherOpen = useShellStore((state) => state.setLauncherOpen);
  const navigation = useSurfaceNavigation();
  const session = useSession();
  const vibes = useVibes();
  const [query, setQuery] = useState("");
  const [launcherMotion, setLauncherMotion] = useState(true);
  const launcherInput = useRef<HTMLInputElement>(null);
  const launcherContainer = useRef<HTMLDivElement>(null);

  const focusedId = focused ? surfaceId(focused) : null;
  const background = open.filter((surface) => surfaceId(surface) !== focusedId);
  // Match the tray's active-app transition: intrinsic flex reflow would move the launcher in
  // the opposite direction for one frame before the tray's 80px reserve starts moving.
  const runningAppsWidth =
    background.length === 0
      ? 0
      : background.length * RUNNING_APP_SIZE + (background.length - 1) * RUNNING_APP_GAP;
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
  const results = useMemo(() => searchShell(query, loadedVibes), [loadedVibes, query]);

  function dismissLauncher({ blurFocus = false, animate = true } = {}) {
    if (
      blurFocus &&
      document.activeElement instanceof HTMLElement &&
      launcherContainer.current?.contains(document.activeElement)
    ) {
      document.activeElement.blur();
    }
    setLauncherMotion(animate);
    setLauncherOpen(false);
    setQuery("");
  }

  function openLauncher() {
    setLauncherMotion(true);
    setLauncherOpen(true);
  }

  useEffect(() => {
    if (!launcherOpen) return;

    function dismissFromOutside(event: PointerEvent) {
      if (event.target instanceof Node && launcherContainer.current?.contains(event.target)) return;
      setLauncherOpen(false);
      setQuery("");
    }

    document.addEventListener("pointerdown", dismissFromOutside, true);
    return () => document.removeEventListener("pointerdown", dismissFromOutside, true);
  }, [launcherOpen, setLauncherOpen]);

  function selectResult(result: ShellSearchResult) {
    dismissLauncher({ blurFocus: true, animate: false });
    if (result.action.kind === "home") {
      navigation.home();
    } else {
      navigation.openFromDock(result.action.surface, {
        origin: launcherContainer.current,
        source: "launcher",
      });
    }
  }

  function handleLauncherKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (launcherOpen && event.key === "Enter" && results[0]) {
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
              onClick={(event) =>
                navigation.openFromDock(HOME_SURFACE, {
                  origin: event.currentTarget,
                  source: "home",
                })
              }
              className="rounded-full transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <VibeOrb src={orbHome} size="lg" alt="" />
              <span className="sr-only">{session.data?.user.handle ?? "Home"}</span>
            </button>
          }
          apps={
            focused ? (
              <DockApp name={labelOf(focused, vibeTitles)} src={markFor(focused)} state="active" />
            ) : null
          }
          tray={
            <DockTray>
              <div
                data-dock-running-apps
                data-count={background.length}
                style={{ width: runningAppsWidth }}
                className="flex min-w-0 shrink items-center gap-5 overflow-hidden transition-[width] duration-100 ease-out"
              >
                {background.map((surface) => (
                  <RunningSurfaceDockApp
                    key={surfaceId(surface)}
                    name={labelOf(surface, vibeTitles)}
                    src={markFor(surface)}
                    onOpen={(event) =>
                      navigation.openFromDock(surface, {
                        origin: event.currentTarget,
                        source: "running",
                      })
                    }
                  />
                ))}
              </div>
              <DockDivider />
              <div
                ref={launcherContainer}
                data-launcher-slot
                className="relative h-12 w-60 shrink-0"
              >
                <LauncherPanel
                  ref={launcherInput}
                  open={launcherOpen}
                  animate={launcherMotion}
                  query={query}
                  onQueryChange={setQuery}
                  onOpen={openLauncher}
                  onInputKeyDown={handleLauncherKeyDown}
                  onDismiss={() => dismissLauncher({ blurFocus: true })}
                  sections={
                    launcherSections.length > 0
                      ? launcherSections
                      : [
                          {
                            title: "No results",
                            items: (
                              <span className="shrink-0 text-body text-on-pill">
                                Try a command or Vibe title.
                              </span>
                            ),
                          },
                        ]
                  }
                />
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
