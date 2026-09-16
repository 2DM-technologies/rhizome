import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import orbHome from "../assets/orbs/orb-home-48.png";
import { uuidOf } from "../api/uris.ts";
import { DarkModeIcon, ImportIcon, LightModeIcon, StartVibeIcon } from "../ui/icons.tsx";
import { useMediaObject, useVibes } from "../queries/index.ts";
import { MediaObjectThumbnail } from "../surfaces/MediaObjectThumbnail.tsx";
import { useNearViewport } from "../ui/useNearViewport.ts";
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
import { useShellStore } from "./store.ts";
import { labelOf, surfaceId, type Surface } from "./surfaces.ts";
import { markForSurface } from "./surfaceMarks.ts";
import { fallbackOrbRecipe, orbVisualForVibe } from "../orb/vibeRecipe.ts";
import { RasterVibeOrb } from "../orb/RasterVibeOrb.tsx";
import { useTheme } from "../theme.tsx";
import { cn } from "../ui/cn.ts";
import { useDockPinsStore, usePinnedVibeUuids } from "./dockPins.ts";

const DOCK_RAIL_ITEM_SIZE = 44;
const DOCK_RAIL_GAP = 20;
const DOCK_RAIL_VISIBLE_ITEMS = 3;
const PINNED_DOCK_SURFACES = [{ kind: "vibes" }, { kind: "import" }] as const;

function iconForDockSurface(surface: Surface) {
  if (surface.kind === "vibes") {
    return <StartVibeIcon width={36} height={36} className="shrink-0 text-primary" />;
  }
  if (surface.kind === "import") {
    return (
      <ImportIcon width={36} height={36} viewBox="1 1 22 22" className="shrink-0 text-primary" />
    );
  }
  return undefined;
}

function ObjectDockPreview({ uuid }: { uuid: string }) {
  const viewport = useNearViewport<HTMLSpanElement>();
  const object = useMediaObject(viewport.active ? uuid : undefined);
  return (
    <span ref={viewport.ref} className="block size-11">
      <MediaObjectThumbnail object={object.data} size={44} />
    </span>
  );
}

/**
 * The persistent shell. The dock and desktop live above the router's control, while the URL
 * decides which surface is focused. Surface navigation replaces the window tree by default;
 * recent routes remain dock shortcuts without keeping their React trees mounted.
 */
export function ShellLayout() {
  const { theme, setTheme } = useTheme();
  const { surface: focused, mode } = useFocusedSurface();
  useEnsureSurfaceOpen(focused);

  const pinnedVibeUuids = usePinnedVibeUuids();
  const recentSurfaces = useShellStore((state) => state.recentSurfaces);
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
    return recentSurfaces.filter(
      (surface) =>
        surfaceId(surface) !== focusedId &&
        (surface.kind !== "vibe" || !vibeCatalogLoaded || vibeTitles.has(surface.uuid)),
    );
  }, [focusedId, recentSurfaces, vibeCatalogLoaded, vibeTitles]);
  const pinnedVibes = pinnedVibeUuids.filter((uuid) => !vibeCatalogLoaded || vibeTitles.has(uuid));

  useEffect(() => {
    function syncPins(event: StorageEvent) {
      if (event.key === "rhizome.dock-pins" || event.key === null) {
        void useDockPinsStore.persist.rehydrate();
      }
    }
    window.addEventListener("storage", syncPins);
    return () => window.removeEventListener("storage", syncPins);
  }, []);
  // Recent windows share three visible slots. Older routes remain available by scrolling.
  const visibleDockRailItems = Math.min(dockRailSurfaces.length, DOCK_RAIL_VISIBLE_ITEMS);
  // Match the tray's active-app transition: an explicit width avoids intrinsic flex reflow
  // moving the launcher in the opposite direction while the active-app reserve animates.
  const dockRailWidth =
    visibleDockRailItems === 0
      ? 0
      : visibleDockRailItems * DOCK_RAIL_ITEM_SIZE + (visibleDockRailItems - 1) * DOCK_RAIL_GAP;
  const dockRailOrder = dockRailSurfaces.map(surfaceId).join("\0");
  const results = useMemo(
    () => searchShell(query, loadedVibes, theme),
    [loadedVibes, query, theme],
  );

  // The rail is an MRU view, so a newly opened page should always restore its newest edge even
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
    if (result.action.kind === "theme") {
      setTheme(result.action.theme);
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
            items: groupResults.map((result) => {
              const surface = result.action.kind === "open" ? result.action.surface : undefined;
              const CommandIcon =
                result.action.kind === "theme"
                  ? result.action.theme === "light"
                    ? LightModeIcon
                    : DarkModeIcon
                  : surface?.kind === "vibes"
                    ? StartVibeIcon
                    : surface?.kind === "import"
                      ? ImportIcon
                      : undefined;
              const orb = surface?.kind === "vibe" ? vibeOrbs.get(surface.uuid) : undefined;
              return (
                <LauncherItem
                  key={result.id}
                  label={result.label}
                  iconStyle={CommandIcon ? "app" : "artwork"}
                  icon={
                    CommandIcon ? (
                      <CommandIcon
                        width={28}
                        height={28}
                        viewBox={surface?.kind === "import" ? "1 1 22 22" : "0 0 24 24"}
                      />
                    ) : orb ? (
                      <RasterVibeOrb recipe={orb.recipe} loading={orb.loading} size={32} />
                    ) : (
                      "⌘"
                    )
                  }
                  onSelect={() => selectResult(result)}
                />
              );
            }),
          },
        ];
  });

  return (
    <Desktop
      theme={theme}
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
                artwork={
                  focused.kind === "object" ? <ObjectDockPreview uuid={focused.uuid} /> : undefined
                }
                icon={iconForDockSurface(focused)}
                recipe={
                  focused.kind === "vibe"
                    ? (vibeOrbs.get(focused.uuid)?.recipe ??
                      fallbackOrbRecipe(`rnet://vibe/${focused.uuid}`))
                    : undefined
                }
                orbLoading={
                  focused.kind === "vibe" ? (vibeOrbs.get(focused.uuid)?.loading ?? true) : false
                }
                state="active"
              />
            ) : null
          }
          tray={
            <DockTray>
              <div
                ref={dockRail}
                role="region"
                aria-label="Recent windows"
                data-dock-recent-surfaces
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
                      artwork={
                        surface.kind === "object" ? (
                          <ObjectDockPreview uuid={surface.uuid} />
                        ) : undefined
                      }
                      icon={iconForDockSurface(surface)}
                      recipe={
                        surface.kind === "vibe"
                          ? (vibeOrbs.get(surface.uuid)?.recipe ??
                            fallbackOrbRecipe(`rnet://vibe/${surface.uuid}`))
                          : undefined
                      }
                      orbLoading={
                        surface.kind === "vibe"
                          ? (vibeOrbs.get(surface.uuid)?.loading ?? true)
                          : false
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
                className={cn(
                  "relative h-12 shrink-0",
                  launcherOpen ? "w-[308px]" : "w-60",
                  launcherMotion ? "transition-[width] duration-100 ease-out" : "transition-none",
                )}
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
              <div
                data-dock-pinned-apps
                role="region"
                aria-label="Pinned apps"
                className="flex min-w-0 flex-1 items-center gap-5"
              >
                {PINNED_DOCK_SURFACES.map((surface) => (
                  <DockApp
                    key={surface.kind}
                    name={labelOf(surface)}
                    src={markForSurface(surface)}
                    icon={iconForDockSurface(surface)}
                    current={focusedId === surfaceId(surface)}
                    onOpen={(event) => {
                      dismissLauncher({ blurFocus: true, animate: false });
                      navigation.openFromDock(surface, {
                        origin: event.currentTarget,
                        source: "pinned",
                      });
                    }}
                  />
                ))}
                {pinnedVibes.length > 0 ? (
                  <div
                    role="region"
                    aria-label="Pinned Vibes"
                    data-dock-pinned-vibes
                    className="min-w-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  >
                    <div className="flex w-max items-center gap-5">
                      {pinnedVibes.map((uuid) => {
                        const surface = { kind: "vibe", uuid } as const;
                        return (
                          <DockApp
                            key={uuid}
                            name={labelOf(surface, vibeTitles)}
                            src={markForSurface(surface)}
                            recipe={
                              vibeOrbs.get(uuid)?.recipe ?? fallbackOrbRecipe(`rnet://vibe/${uuid}`)
                            }
                            orbLoading={vibeOrbs.get(uuid)?.loading ?? true}
                            current={focusedId === surfaceId(surface)}
                            onOpen={(event) => {
                              dismissLauncher({ blurFocus: true, animate: false });
                              navigation.openFromDock(surface, {
                                origin: event.currentTarget,
                                source: "pinned",
                              });
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </DockTray>
          }
        />
      }
    >
      <DesktopHome visible={focused === null} />
      <SurfaceLayer />
    </Desktop>
  );
}
