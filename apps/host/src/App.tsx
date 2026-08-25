import { useState } from "react";

import marks from "./assets/brand/app-mark.png";
import orb1 from "./assets/orbs/orb-1-44.png";
import orb2 from "./assets/orbs/orb-2-44.png";
import orbHome from "./assets/orbs/orb-home-48.png";
import { Desktop, Dock, DockApp, DockDivider, DockTray, SearchField, VibeOrb } from "./ui/index.ts";

/**
 * Placeholder shell. The dock, desktop, and window chrome are real components from the
 * design system; the surfaces they host arrive with the store-backed screens.
 */
export function App() {
  const [query, setQuery] = useState("");
  return (
    <Desktop
      dock={
        <Dock
          leading={<VibeOrb src={orbHome} size="lg" alt="Home" />}
          apps={<DockApp name="Rhizome" src={marks} state="active" />}
          tray={
            <DockTray>
              <div className="flex min-w-0 shrink items-center gap-5 overflow-hidden">
                <DockApp name="Spending" src={orb1} />
                <DockApp name="Library" src={orb2} />
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
    />
  );
}
