import { DmachineSurface } from "../surfaces/DmachineSurface.tsx";
import { ObjectSurface } from "../surfaces/ObjectSurface.tsx";
import { VibeSurface } from "../surfaces/VibeSurface.tsx";
import { VibesSurface } from "../surfaces/VibesSurface.tsx";
import type { Surface } from "./surfaces.ts";

/** Kind to component. The shell knows nothing else about what a surface contains. */
export function SurfaceView({ surface }: { surface: Surface }) {
  switch (surface.kind) {
    case "vibes":
      return <VibesSurface />;
    case "vibe":
      return <VibeSurface uuid={surface.uuid} />;
    case "object":
      return <ObjectSurface uuid={surface.uuid} />;
    case "dmachine":
      return <DmachineSurface name={surface.name} />;
  }
}
