import { Provisional } from "./provisional.tsx";

/**
 * Where a dMachine's sandboxed iframe goes at M4.
 *
 * Nothing is loaded here yet, and nothing pretends to be: the SDK bridge, the hash-labelled
 * cross-site origin, and the capability table all arrive together with `@rhizome/dmachine-sdk`.
 * What is real today is everything around it — this surface is registered, focusable, listed
 * in the dock, survives being backgrounded, and can be maximized, which is what the iframe
 * will need on the day it exists.
 */
export function DmachineSurface({ name }: { name: string }) {
  return (
    <Provisional title={name} detail="dMachine surface — sandboxed iframe lands at M4">
      <p className="text-body text-secondary">
        This window is a placeholder. The surface, its dock entry, and its geometry are real; the
        guest that runs inside it is not built yet.
      </p>
    </Provisional>
  );
}
