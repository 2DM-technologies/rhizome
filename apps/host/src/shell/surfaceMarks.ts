import appMark from "../assets/brand/app-mark.png";
import type { Surface } from "./surfaces.ts";

/** dMachines retain their app mark; Vibes and objects supply their own artwork. */
export function markForSurface(surface: Surface): string | undefined {
  return surface.kind === "dmachine" ? appMark : undefined;
}
