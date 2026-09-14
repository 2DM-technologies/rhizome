import appMark from "../assets/brand/app-mark.png";
import orb1 from "../assets/orbs/orb-1-44.png";
import orb2 from "../assets/orbs/orb-2-44.png";
import orb3 from "../assets/orbs/orb-3-44.png";
import orb4 from "../assets/orbs/orb-4-44.png";
import orbVibes from "../assets/orbs/orb-vibes-96.png";
import { surfaceId, type Surface } from "./surfaces.ts";

/** Temporary marks until Vibes own a persisted image assignment. */
const STAND_IN_ORBS = [orb1, orb2, orb3, orb4];

/** Preserve the existing deterministic stand-in behavior from every rendering location. */
export function markForSurface(surface: Surface): string {
  if (surface.kind === "dmachine") return appMark;
  if (surface.kind === "vibes") return orbVibes;
  const id = surfaceId(surface);
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) % 997;
  return STAND_IN_ORBS[hash % STAND_IN_ORBS.length] as string;
}
