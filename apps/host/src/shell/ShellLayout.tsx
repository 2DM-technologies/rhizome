import { useState } from "react";

import appMark from "../assets/brand/app-mark.png";
import orb1 from "../assets/orbs/orb-1-44.png";
import orb2 from "../assets/orbs/orb-2-44.png";
import orb3 from "../assets/orbs/orb-3-44.png";
import orb4 from "../assets/orbs/orb-4-44.png";
import orbHome from "../assets/orbs/orb-home-48.png";
import { useSession } from "../session/session.ts";
import {
  Desktop,
  Dock,
  DockApp,
  DockDivider,
  DockTray,
  SearchField,
  VibeOrb,
} from "../ui/index.ts";
import { SurfaceLayer } from "./SurfaceLayer.tsx";
import { useEnsureSurfaceOpen, useFocusedSurface, useSurfaceNavigation } from "./focus.ts";
import { useOpenSurfaces } from "./store.ts";
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
  const { open: openSurface, toggleFullScreen } = useSurfaceNavigation();
  const session = useSession();
  const [query, setQuery] = useState("");

  const focusedId = focused ? surfaceId(focused) : null;
  const background = open.filter((surface) => surfaceId(surface) !== focusedId);

  return (
    <Desktop
      dock={
        <Dock
          leading={<VibeOrb src={orbHome} size="lg" alt={session.data?.user.handle ?? "Home"} />}
          apps={
            focused ? (
              <DockApp
                name={`${labelOf(focused)} — ${mode === "full" ? "exit full screen" : "full screen"}`}
                src={markFor(focused)}
                state="active"
                onOpen={toggleFullScreen}
              />
            ) : null
          }
          tray={
            <DockTray>
              <div className="flex min-w-0 shrink items-center gap-5 overflow-hidden">
                {background.map((surface) => (
                  <DockApp
                    key={surfaceId(surface)}
                    name={labelOf(surface)}
                    src={markFor(surface)}
                    onOpen={() => openSurface(surface)}
                  />
                ))}
              </div>
              <DockDivider />
              <SearchField
                className="shrink-0"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </DockTray>
          }
        />
      }
    >
      <SurfaceLayer />
    </Desktop>
  );
}
