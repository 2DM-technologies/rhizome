import { SurfaceChrome } from "./SurfaceChrome.tsx";
import { SurfaceView } from "./SurfaceView.tsx";
import { useFocusedSurface } from "./focus.ts";
import { useOpenSurfaces } from "./store.ts";
import { surfaceId } from "./surfaces.ts";

/**
 * Every open surface, mounted once.
 *
 * This is the piece that makes the shell a shell. Surfaces are keyed by identity and rendered
 * for as long as they are open, so navigating between them changes which one is visible and
 * nothing else — no unmount, no refetch, no lost scroll position, and at M4 no iframe reload,
 * which would destroy a dMachine's entire state.
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
