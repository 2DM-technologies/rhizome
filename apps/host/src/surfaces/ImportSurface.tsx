import { useMemo, useState, type FormEvent } from "react";

import { uuidOf } from "../api/uris.ts";
import { useCreateVibe, useVibe, useVibes } from "../queries/index.ts";
import { useSession } from "../session/session.ts";
import { Button } from "../ui/index.ts";
import { ImportPanel } from "./ImportPanel.tsx";
import { Failed, Pending, StoreSurface } from "./provisional.tsx";

/**
 * Host-owned entry point for transaction files that do not start inside a Vibe.
 *
 * Target selection is local surface state on purpose. It survives for the lifetime of this
 * window; a caller that needs to open another surface without losing a staged review can use the
 * shell navigation's explicit keep-open option.
 */
export function ImportSurface() {
  const session = useSession();
  const vibes = useVibes();
  const create = useCreateVibe();
  const [targetUuid, setTargetUuid] = useState<string>();
  const [title, setTitle] = useState("");
  const target = useVibe(targetUuid);

  const ownedVibes = useMemo(
    () => (vibes.data ?? []).filter((vibe) => vibe.owner === session.data?.user.id),
    [session.data?.user.id, vibes.data],
  );
  const targetIsOwned = target.data?.owner === session.data?.user.id;

  function createTarget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) return;
    create.mutate(
      { body: { title: nextTitle } },
      {
        onSuccess: (vibe) => {
          setTitle("");
          setTargetUuid(uuidOf(vibe.uri));
        },
      },
    );
  }

  function chooseAnotherTarget() {
    setTargetUuid(undefined);
    create.reset();
  }

  return (
    <StoreSurface
      title="Import transactions"
      detail={
        target.data && targetIsOwned
          ? `Target Vibe: ${target.data.title}`
          : "Choose an owned Vibe before selecting a transaction export."
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
          {target.isPending ? <Pending label="target Vibe" /> : null}
          {target.isError ? <Failed error={target.error} /> : null}
          {target.data && !targetIsOwned ? (
            <span role="alert" className="text-body text-error">
              You must own the target Vibe to import transactions.
            </span>
          ) : null}
          {target.data && targetIsOwned ? (
            <ImportPanel
              vibeUuid={targetUuid}
              hasConfiguredSources={Boolean(
                target.data.pull?.enabled && target.data.pull.sources?.length,
              )}
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
                  <button
                    type="button"
                    aria-label={`Import into ${vibe.title}`}
                    onClick={() => setTargetUuid(uuidOf(vibe.uri))}
                    className="flex w-full items-baseline gap-3 border-b border-[rgba(20,20,26,0.06)] py-3 text-left"
                  >
                    <span className="min-w-0 flex-1 truncate text-label text-primary">
                      {vibe.title}
                    </span>
                    <span className="text-caption text-tertiary">
                      {vibe.objects.length} objects
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <form
            aria-labelledby="create-import-vibe"
            onSubmit={createTarget}
            className="flex flex-col gap-3 border-t border-hairline pt-6"
          >
            <div>
              <h2 id="create-import-vibe" className="text-label text-primary">
                Create a new Vibe
              </h2>
              <p className="mt-1 text-body text-secondary">
                The new Vibe becomes the target for this import.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <label className="min-w-0 flex-1">
                <span className="sr-only">New import Vibe title</span>
                <input
                  aria-label="New import Vibe title"
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    create.reset();
                  }}
                  placeholder="Name a new Vibe"
                  maxLength={256}
                  className="w-full rounded-pill border border-hairline bg-surface px-5 py-3 text-body text-primary outline-none placeholder:text-tertiary focus-visible:outline-2 focus-visible:outline-accent"
                />
              </label>
              <Button type="submit" disabled={!title.trim() || create.isPending}>
                {create.isPending ? "Creating…" : "Create and continue"}
              </Button>
            </div>
            {create.isError ? <Failed error={create.error} /> : null}
          </form>
        </div>
      )}
    </StoreSurface>
  );
}
