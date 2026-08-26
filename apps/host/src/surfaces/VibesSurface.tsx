import { useVibes } from "../queries/index.ts";
import { useSurfaceNavigation } from "../shell/focus.ts";
import { uuidOf } from "../api/uris.ts";
import { Failed, Pending, Provisional } from "./provisional.tsx";

/** Provisional. The designed vibe browser is being drawn in Figma. */
export function VibesSurface() {
  const vibes = useVibes();
  const { open } = useSurfaceNavigation();

  return (
    <Provisional title="Vibes" detail="Every Vibe you own or have been granted">
      {vibes.isPending ? <Pending label="vibes" /> : null}
      {vibes.isError ? <Failed error={vibes.error} /> : null}
      {vibes.data?.length === 0 ? (
        <span className="text-body text-tertiary">No Vibes yet.</span>
      ) : null}
      <ul className="flex flex-col">
        {vibes.data?.map((vibe) => (
          <li key={vibe.uri}>
            <button
              type="button"
              onClick={() => open({ kind: "vibe", uuid: uuidOf(vibe.uri) })}
              className="flex w-full items-baseline gap-3 border-b border-[rgba(20,20,26,0.06)] py-3 text-left"
            >
              <span className="min-w-0 flex-1 truncate text-label text-primary">{vibe.title}</span>
              <span className="text-caption text-tertiary">{vibe.objects.length} objects</span>
            </button>
          </li>
        ))}
      </ul>
    </Provisional>
  );
}
