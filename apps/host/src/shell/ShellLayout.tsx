import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import orbHome from "../assets/orbs/orb-home-48.png";
import { uuidOf } from "../api/uris.ts";
import { useVibes } from "../queries/index.ts";
import {
  Desktop,
  Dock,
  DockApp,
  DockDivider,
  DockTray,
  LauncherItem,
  LauncherPanel,
  OrbButton,
} from "../ui/index.ts";
import { SurfaceLayer } from "./SurfaceLayer.tsx";
import { DesktopHome } from "./DesktopHome.tsx";
import { useEnsureSurfaceOpen, useFocusedSurface, useSurfaceNavigation } from "./focus.ts";
import { searchShell, SHELL_SEARCH_GROUPS, type ShellSearchResult } from "./search.ts";
import { useOpenSurfaces, useShellStore } from "./store.ts";
import { isVibeSurface, labelOf, surfaceId, type Surface } from "./surfaces.ts";
import { markForSurface } from "./surfaceMarks.ts";
import { orbVisualForVibe } from "../orb/vibeRecipe.ts";

const DOCK_RAIL_ITEM_SIZE = 44;
const DOCK_RAIL_GAP = 20;
const DOCK_RAIL_VISIBLE_VIBE_ITEMS = 3;

/**
 * The persistent shell. The dock and desktop live above the router's control, while the URL
 * decides which surface is focused. Surface navigation replaces the window tree by default;
 * callers can explicitly retain a background window when its local state must survive.
 */
export function ShellLayout() {
  const { surface: focused, mode } = useFocusedSurface();
  useEnsureSurfaceOpen(focused);

  const open = useOpenSurfaces();
  const recentVibeSurfaces = useShellStore((state) => state.recentVibeSurfaces);
  const defaultViewMode = useShellStore((state) => state.defaultViewMode);
  const launcherOpen = useShellStore((state) => state.launcherOpen);
  const setLauncherOpen = useShellStore((state) => state.setLauncherOpen);
  const navigation = useSurfaceNavigation();
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
        orb: orbVisualForVibe(vibe),
      })),
    [vibes.data],
  );
  const vibeTitles = useMemo(
    () => new Map(loadedVibes.map((vibe) => [vibe.uuid, vibe.title])),
    [loadedVibes],
  );
  const vibeOrbs = useMemo(
    () => new Map(loadedVibes.map((vibe) => [vibe.uuid, vibe.orb])),
    [loadedVibes],
  );
  const vibeCatalogLoaded = vibes.data !== undefined;
  const dockRailSurfaces = useMemo(() => {
    // Preserve the persisted rail geometry with fallback labels during hydration. Once the
    // authoritative catalog arrives, missing or deleted Vibes disappear from the shortcuts.
    const recentVibes = recentVibeSurfaces.filter(
      (surface) =>
        surfaceId(surface) !== focusedId &&
        (surface.kind === "vibes" || !vibeCatalogLoaded || vibeTitles.has(surface.uuid)),
    );

    // Every Vibe route already appears in the shared recency list. Pin only other explicitly
    // retained windows before those shortcuts so one route cannot appear twice in the rail.
    return [...background.filter((surface) => !isVibeSurface(surface)), ...recentVibes];
  }, [background, focusedId, recentVibeSurfaces, vibeCatalogLoaded, vibeTitles]);
  const retainedDockRailItems = dockRailSurfaces.filter(
    (surface) => !isVibeSurface(surface),
  ).length;
  // Retained windows do not consume the three visible MRU Vibe slots. Additional Vibes remain
  // available through the scrollbar-free horizontal rail.
  const visibleDockRailItems = Math.min(
    dockRailSurfaces.length,
    retainedDockRailItems + DOCK_RAIL_VISIBLE_VIBE_ITEMS,
  );
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
            <OrbButton
              label="Home"
              src={orbHome}
              onClick={(event) =>
                navigation.home({
                  origin: event.currentTarget,
                  source: "home",
                })
              }
            />
          }
          apps={
            focused ? (
              <DockApp
                name={labelOf(focused, vibeTitles)}
                src={markForSurface(focused)}
                recipe={focused.kind === "vibe" ? vibeOrbs.get(focused.uuid)?.recipe : undefined}
                orbLoading={focused.kind === "vibe" ? vibeOrbs.get(focused.uuid)?.loading : false}
                state="active"
              />
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
                style={{
                  width: dockRailWidth,
                  // The empty rail stays mounted for its width transition but needs no tray gap.
                  marginRight: dockRailSurfaces.length === 0 ? -DOCK_RAIL_GAP : 0,
                }}
                className="min-w-0 shrink-0 overflow-x-auto overflow-y-hidden transition-[width,margin-right] duration-100 ease-out [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                <div className="flex w-max items-center gap-5">
                  {dockRailSurfaces.map((surface) => (
                    <DockApp
                      key={surfaceId(surface)}
                      name={labelOf(surface, vibeTitles)}
                      src={markForSurface(surface)}
                      recipe={
                        surface.kind === "vibe" ? vibeOrbs.get(surface.uuid)?.recipe : undefined
                      }
                      orbLoading={
                        surface.kind === "vibe" ? vibeOrbs.get(surface.uuid)?.loading : false
                      }
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
              <div
                aria-hidden
                style={{
                  width: dockRailSurfaces.length === 0 ? 0 : 1,
                  marginRight: dockRailSurfaces.length === 0 ? -DOCK_RAIL_GAP : 0,
                }}
                className="flex shrink-0 overflow-hidden transition-[width,margin-right] duration-100 ease-out"
              >
                <DockDivider />
              </div>
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
      {focused === null ? <DesktopHome /> : null}
      <SurfaceLayer />
    </Desktop>
  );
}
