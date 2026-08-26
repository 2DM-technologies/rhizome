import { useVibe, useVibeObjects } from "../queries/index.ts";
import { useSurfaceNavigation } from "../shell/focus.ts";
import { uuidOf } from "../api/uris.ts";
import { Failed, Pending, Provisional } from "./provisional.tsx";

/**
 * Deliberately unbuilt. The Vibe page is being designed in Figma; this renders only enough to
 * show the queries resolve and the surface participates in focus, full screen, and the dock.
 * Replacing it should not require touching anything in `shell/`.
 */
export function VibeSurface({ uuid }: { uuid: string }) {
  const vibe = useVibe(uuid);
  const objects = useVibeObjects(uuid);
  const { open } = useSurfaceNavigation();

  return (
    <Provisional title={vibe.data?.title ?? "Vibe"} detail={vibe.data?.uri}>
      {vibe.isPending ? <Pending label="vibe" /> : null}
      {vibe.isError ? <Failed error={vibe.error} /> : null}
      <ul className="flex flex-col">
        {objects.data?.map((object) => (
          <li key={object.uri}>
            <button
              type="button"
              onClick={() => open({ kind: "object", uuid: uuidOf(object.uri) })}
              className="flex w-full items-baseline gap-3 border-b border-[rgba(20,20,26,0.06)] py-3 text-left"
            >
              <span className="text-mono-label text-tertiary">{object.type}</span>
              <span className="min-w-0 flex-1 truncate text-label text-primary">{object.uri}</span>
              <span className="text-caption text-tertiary">{object.elements.length} elements</span>
            </button>
          </li>
        ))}
      </ul>
    </Provisional>
  );
}
