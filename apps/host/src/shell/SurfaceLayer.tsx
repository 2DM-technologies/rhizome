import { SurfaceChrome } from "./SurfaceChrome.tsx";
import { SurfaceView } from "./SurfaceView.tsx";
import { useFocusedSurface } from "./focus.ts";
import { surfaceId } from "./surfaces.ts";

/** Only the focused route owns a mounted window; dock history is metadata, not hidden UI. */
export function SurfaceLayer() {
  const { surface: focused, mode } = useFocusedSurface();
  if (!focused) return null;

  return (
    <SurfaceChrome key={surfaceId(focused)} surface={focused} active mode={mode}>
      <SurfaceView surface={focused} />
    </SurfaceChrome>
  );
}
