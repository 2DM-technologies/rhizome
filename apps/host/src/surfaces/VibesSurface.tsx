import { useMemo } from "react";
import type { Vibe } from "@rnet/types";

import { RasterVibeOrb } from "../orb/RasterVibeOrb.tsx";
import { orbVisualForVibe } from "../orb/vibeRecipe.ts";
import { useVibes } from "../queries/index.ts";
import { useSurfaceNavigation } from "../shell/focus.ts";
import { uuidOf } from "../api/uris.ts";
import { Button, EntityRow } from "../ui/index.ts";
import { StartVibeIcon } from "../ui/icons.tsx";
import { StartVibeGlow } from "../ui/StartVibeGlow.tsx";
import { Failed, Pending, StoreSurface } from "./provisional.tsx";

function VibeListItem({ vibe, open }: { vibe: Vibe; open: () => void }) {
  const visual = useMemo(() => orbVisualForVibe(vibe), [vibe]);
  return (
    <li>
      <EntityRow
        className="transition-[background-color,box-shadow] duration-150 hover:bg-surface/40 hover:shadow-[0_0_4px_0px_var(--rz-vibe-hover-shadow)] focus-within:bg-surface/40 focus-within:shadow-[0_0_4px_0px_var(--rz-vibe-hover-shadow)] motion-reduce:transition-none [&>button]:cursor-pointer"
        leading={<RasterVibeOrb recipe={visual.recipe} loading={visual.loading} size={20} />}
        title={vibe.title}
        meta={`${vibe.objects.length} objects`}
        selectLabel={`Open Vibe ${vibe.title}`}
        onSelect={open}
      />
    </li>
  );
}

export function VibesSurface() {
  const vibes = useVibes();
  const { open } = useSurfaceNavigation();
  return (
    <StoreSurface title="Vibes" detail="Every Vibe you own or have been granted">
      <Button
        variant="secondary"
        className="start-vibe-button mb-6 self-start gap-2 rounded-md! px-4! py-2.5! text-[15px]! leading-[1.4]! font-medium!"
        onClick={() => open({ kind: "import" })}
      >
        <StartVibeGlow />
        <span>Start a Vibe</span>
        <StartVibeIcon />
      </Button>
      {vibes.isPending ? <Pending label="vibes" /> : null}
      {vibes.isError ? <Failed error={vibes.error} /> : null}
      {vibes.data?.length === 0 ? (
        <span className="text-body text-tertiary">No Vibes yet.</span>
      ) : null}
      <ul className="flex flex-col">
        {vibes.data?.map((vibe) => (
          <VibeListItem
            key={vibe.uri}
            vibe={vibe}
            open={() => open({ kind: "vibe", uuid: uuidOf(vibe.uri) })}
          />
        ))}
      </ul>
    </StoreSurface>
  );
}
