import {
  useEffect,
  useLayoutEffect,
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
const DOCK_RAIL_ITEM_SIZE = 44;
const DOCK_RAIL_GAP = 20;
const DOCK_RAIL_VISIBLE_ITEMS = 3;
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
 * The persistent shell. The dock and desktop live above the router's control, while the URL
 * decides which surface is focused. Surface navigation replaces the window tree by default;
 * callers can explicitly retain a background window when its local state must survive.
 */
export function ShellLayout() {
  const { surface: focused, mode } = useFocusedSurface();
  useEnsureSurfaceOpen(focused, mode);

  const open = useOpenSurfaces();
  const recentVibeUuids = useShellStore((state) => state.recentVibeUuids);
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
  const dockRail = useRef<HTMLDivElement>(null);

  const focusedId = focused ? surfaceId(focused) : null;
  const background = useMemo(
    () => open.filter((surface) => surfaceId(surface) !== focusedId),
    [focusedId, open],
  );
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
  const vibeCatalogLoaded = vibes.data !== undefined;
  const dockRailSurfaces = useMemo(() => {
    const focusedVibeUuid = focused?.kind === "vibe" ? focused.uuid : null;
    // Preserve the persisted rail geometry with fallback labels during hydration. Once the
    // authoritative catalog arrives, missing or deleted Vibes disappear from the shortcuts.
    const recentVibes: Surface[] = recentVibeUuids.flatMap((uuid) =>
      uuid !== focusedVibeUuid && (!vibeCatalogLoaded || vibeTitles.has(uuid))
        ? [{ kind: "vibe", uuid }]
        : [],
    );

    // A retained Vibe already appears in the recency list. Keep other explicitly retained
    // surface kinds reachable after recents without letting mounted-window state dictate MRU.
    return [...recentVibes, ...background.filter((surface) => surface.kind !== "vibe")];
  }, [background, focused, recentVibeUuids, vibeCatalogLoaded, vibeTitles]);
  const visibleDockRailItems = Math.min(dockRailSurfaces.length, DOCK_RAIL_VISIBLE_ITEMS);
  // Match the tray's active-app transition: an explicit width avoids intrinsic flex reflow
  // moving the launcher in the opposite direction while the active-app reserve animates.
  const dockRailWidth =
    visibleDockRailItems === 0
      ? 0
      : visibleDockRailItems * DOCK_RAIL_ITEM_SIZE + (visibleDockRailItems - 1) * DOCK_RAIL_GAP;
  const dockRailOrder = dockRailSurfaces.map(surfaceId).join("\0");
  const results = useMemo(() => searchShell(query, loadedVibes), [loadedVibes, query]);

  // The rail is an MRU view, so a newly opened Vibe should always restore its newest edge even
  // if the user had scrolled back through older entries immediately beforehand.
  useLayoutEffect(() => {
    dockRail.current?.scrollTo({ left: 0 });
  }, [dockRailOrder]);

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
                ref={dockRail}
                role="region"
                aria-label="Recent Vibes and retained windows"
                data-dock-recent-vibes
                data-dock-running-apps
                data-count={dockRailSurfaces.length}
                style={{ width: dockRailWidth }}
                className="min-w-0 shrink-0 overflow-x-auto overflow-y-hidden transition-[width] duration-100 ease-out [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                <div className="flex w-max items-center gap-5">
                  {dockRailSurfaces.map((surface) => (
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
