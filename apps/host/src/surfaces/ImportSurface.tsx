import { useSurfaceNavigation } from "../shell/focus.ts";
import { ImportPanel } from "./ImportPanel.tsx";
import { Pending, StoreSurface } from "./provisional.tsx";
import { useSourceConnectionReturn } from "./sourceConnectionReturn.ts";

/** Host-owned entry point for reviewing a source before creating its new Vibe. */
export function ImportSurface() {
  const { open } = useSurfaceNavigation();
  const sourceConnectionReturn = useSourceConnectionReturn({ kind: "new_vibe" });

  return (
    <StoreSurface
      title="Import"
      detail="The new Vibe will be created only when you confirm its reviewed import."
    >
      <div className="flex flex-col gap-4">
        {sourceConnectionReturn.isPending ? (
          <Pending label="source connection" />
        ) : (
          <ImportPanel
            configuredSources={[]}
            sourceConnectionReturn={sourceConnectionReturn}
            onPendingVibeConfirmed={(vibeUuid) => open({ kind: "vibe", uuid: vibeUuid })}
          />
        )}
      </div>
    </StoreSurface>
  );
}
