import { SurfaceChrome } from "./SurfaceChrome.tsx";
import { SurfaceView } from "./SurfaceView.tsx";
import { useFocusedSurface } from "./focus.ts";
import { useOpenSurfaces } from "./store.ts";
import { surfaceId } from "./surfaces.ts";

/**
 * Every deliberately open surface, mounted once.
 *
 * Default navigation keeps this set to one window so inactive React trees cannot accumulate.
 * An explicit keep-open navigation may retain additional keyed surfaces for workflows where
 * preserving local state or a future dMachine iframe is worth the memory cost.
 */
export function SurfaceLayer() {
  const open = useOpenSurfaces();
  const { surface: focused, mode } = useFocusedSurface();
  const focusedId = focused ? surfaceId(focused) : null;

  return (
    <>
      {open.map((surface) => {
        const id = surfaceId(surface);
        return (
          <SurfaceChrome key={id} surface={surface} active={id === focusedId} mode={mode}>
            <SurfaceView surface={surface} />
          </SurfaceChrome>
        );
      })}
    </>
  );
}
