import { useMemo, useState } from "react";

import { uuidOf } from "../api/uris.ts";
import { useVibe, useVibes } from "../queries/index.ts";
import { useSession } from "../session/session.ts";
import { Button, EntityRow } from "../ui/index.ts";
import { ImportPanel } from "./ImportPanel.tsx";
import { Failed, Pending, StoreSurface } from "./provisional.tsx";

/**
 * Host-owned entry point for reviewed sources that do not start inside a Vibe.
 *
 * Target selection is local surface state on purpose. It survives for the lifetime of this
 * window; a caller that needs to open another surface without losing a staged review can use the
 * shell navigation's explicit keep-open option.
 */
export function ImportSurface() {
  const session = useSession();
  const vibes = useVibes();
  const [targetUuid, setTargetUuid] = useState<string | "pending">();
  const target = useVibe(targetUuid === "pending" ? undefined : targetUuid);

  const ownedVibes = useMemo(
    () => (vibes.data ?? []).filter((vibe) => vibe.owner === session.data?.user.id),
    [session.data?.user.id, vibes.data],
  );
  const targetIsOwned = target.data?.owner === session.data?.user.id;

  function chooseAnotherTarget() {
    setTargetUuid(undefined);
  }

  return (
    <StoreSurface
      title="Import"
      detail={
        targetUuid === "pending"
          ? "The new Vibe will be created only when you confirm its reviewed import."
          : target.data && targetIsOwned
            ? `Target Vibe: ${target.data.title}`
            : "Choose an owned Vibe before selecting a source."
      }
      actions={
        targetUuid ? (
          <Button variant="secondary" onClick={chooseAnotherTarget}>
            Choose another Vibe
          </Button>
        ) : null
      }
    >
      {targetUuid ? (
        <div className="flex flex-col gap-4">
          {targetUuid !== "pending" && target.isPending ? <Pending label="target Vibe" /> : null}
          {target.isError ? <Failed error={target.error} /> : null}
          {target.data && !targetIsOwned ? (
            <span role="alert" className="text-body text-error">
              You must own the target Vibe to import into it.
            </span>
          ) : null}
          {targetUuid === "pending" ? (
            <ImportPanel
              configuredSources={[]}
              onPendingVibeConfirmed={(vibeUuid) => setTargetUuid(vibeUuid)}
            />
          ) : target.data && targetIsOwned ? (
            <ImportPanel
              vibeUuid={targetUuid}
              configuredSources={target.data.pull?.enabled ? (target.data.pull.sources ?? []) : []}
            />
          ) : null}
        </div>
      ) : (
        <div className="flex max-w-[52rem] flex-col gap-7">
          <section aria-labelledby="import-existing-vibe" className="flex flex-col gap-3">
            <div>
              <h2 id="import-existing-vibe" className="text-label text-primary">
                Choose an existing Vibe
              </h2>
              <p className="mt-1 text-body text-secondary">
                Only Vibes you own can receive a new ingestion source.
              </p>
            </div>
            {vibes.isPending ? <Pending label="Vibes" /> : null}
            {vibes.isError ? <Failed error={vibes.error} /> : null}
            {!vibes.isPending && ownedVibes.length === 0 ? (
              <span className="text-body text-tertiary">You do not own a Vibe yet.</span>
            ) : null}
            <ul aria-label="Owned Vibes" className="flex flex-col">
              {ownedVibes.map((vibe) => (
                <li key={vibe.uri}>
                  <EntityRow
                    align="baseline"
                    title={vibe.title}
                    meta={`${vibe.objects.length} objects`}
                    selectLabel={`Import into ${vibe.title}`}
                    onSelect={() => setTargetUuid(uuidOf(vibe.uri))}
                  />
                </li>
              ))}
            </ul>
          </section>

          <section
            aria-labelledby="create-import-vibe"
            className="flex flex-col gap-3 border-t border-hairline pt-6"
          >
            <div>
              <h2 id="create-import-vibe" className="text-label text-primary">
                Create a new Vibe
              </h2>
              <p className="mt-1 text-body text-secondary">
                Review a source first. The Vibe is created atomically when you confirm.
              </p>
            </div>
            <Button className="self-start" onClick={() => setTargetUuid("pending")}>
              Import into a new Vibe
            </Button>
          </section>
        </div>
      )}
    </StoreSurface>
  );
}
