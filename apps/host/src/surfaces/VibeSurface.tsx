import { useEffect, useId, useState, type FormEvent } from "react";
import { rnetUriPattern } from "@rnet/types/patterns";

import {
  useAddVibeObjects,
  useDeleteVibe,
  useRemoveVibeObjects,
  useUpdateVibe,
  useVibe,
  useVibeObjects,
} from "../queries/index.ts";
import { mediaObjectDisplayName } from "../mediaObjectDisplayName.ts";
import { useSession } from "../session/session.ts";
import { useSurfaceNavigation } from "../shell/focus.ts";
import { uuidOf } from "../api/uris.ts";
import { Button, InlineError, TextInput } from "../ui/index.ts";
import { surfaceId } from "../shell/surfaces.ts";
import { Failed, Pending, StoreSurface } from "./provisional.tsx";
import { ImportPanel } from "./ImportPanel.tsx";
import { useSourceConnectionReturn } from "./sourceConnectionReturn.ts";
import { InferredVibeView, inferredVibeView } from "./InferredVibeView.tsx";
import { PushControl } from "./PushControl.tsx";
import { MediaObjectEntry } from "./MediaObjectEntry.tsx";

const OBJECT_URI = new RegExp(rnetUriPattern("object"));

export function VibeSurface({ uuid }: { uuid: string }) {
  const sourceConnectionReturn = useSourceConnectionReturn({
    kind: "existing_vibe",
    vibeUuid: uuid,
  });
  const vibe = useVibe(uuid);
  const objects = useVibeObjects(uuid);
  const update = useUpdateVibe();
  const remove = useRemoveVibeObjects();
  const add = useAddVibeObjects();
  const deleteVibe = useDeleteVibe();
  const session = useSession();
  const { open, close } = useSurfaceNavigation();
  const objectUriErrorId = useId();
  const importPanelId = useId();
  const [importExpanded, setImportExpanded] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [objectUri, setObjectUri] = useState("");
  const [objectUriError, setObjectUriError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const title = titleDraft ?? vibe.data?.title ?? "";
  const isOwner = vibe.data?.owner === session.data?.user.id;

  useEffect(() => {
    if (sourceConnectionReturn.attemptId || sourceConnectionReturn.failureMessage) {
      setImportExpanded(true);
    }
  }, [sourceConnectionReturn.attemptId, sourceConnectionReturn.failureMessage]);

  function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle || !vibe.data) return;
    update.mutate(
      { params: { path: { id: uuid } }, body: { title: nextTitle } },
      { onSuccess: () => setTitleDraft(null) },
    );
  }

  function addObject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const uri = objectUri.trim();
    if (!uri) return;
    if (!OBJECT_URI.test(uri)) {
      setObjectUriError("Enter a canonical rnet://object/{uuidv7} URI.");
      return;
    }
    setObjectUriError(null);
    add.mutate(
      { params: { path: { id: uuid } }, body: { objects: [uri] } },
      { onSuccess: () => setObjectUri("") },
    );
  }

  function confirmVibeDeletion() {
    deleteVibe.mutate(
      { params: { path: { id: uuid } } },
      { onSuccess: () => close(surfaceId({ kind: "vibe", uuid })) },
    );
  }

  return (
    <StoreSurface
      title={vibe.data?.title ?? "Vibe"}
      detail={vibe.data?.uri}
      actions={
        vibe.data && isOwner ? (
          <div className="flex items-center gap-2">
            {confirmDelete ? (
              <>
                <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  aria-label="Confirm delete Vibe"
                  onClick={confirmVibeDeletion}
                  disabled={deleteVibe.isPending}
                >
                  {deleteVibe.isPending ? "Deleting…" : "Confirm delete"}
                </Button>
              </>
            ) : (
              <Button variant="secondary" onClick={() => setConfirmDelete(true)}>
                Delete Vibe
              </Button>
            )}
          </div>
        ) : null
      }
    >
      {vibe.isPending ? <Pending label="vibe" /> : null}
      {vibe.isError ? <Failed error={vibe.error} /> : null}
      {deleteVibe.isError ? <Failed error={deleteVibe.error} /> : null}

      {vibe.data && isOwner ? (
        <div className="mb-7 flex flex-col gap-4 border-b border-hairline pb-7">
          <form onSubmit={rename} className="flex max-w-[42rem] items-center gap-3">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Vibe title</span>
              <TextInput
                aria-label="Vibe title"
                value={title}
                onChange={(event) => setTitleDraft(event.target.value)}
                maxLength={256}
              />
            </label>
            <Button
              type="submit"
              variant="secondary"
              disabled={!title.trim() || titleDraft === null || update.isPending}
            >
              {update.isPending ? "Renaming…" : "Rename Vibe"}
            </Button>
          </form>
          {update.isError ? <Failed error={update.error} /> : null}

          <form onSubmit={addObject} className="flex max-w-[42rem] items-center gap-3">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Object URI</span>
              <TextInput
                aria-label="Object URI"
                aria-invalid={objectUriError ? true : undefined}
                aria-describedby={objectUriError ? objectUriErrorId : undefined}
                value={objectUri}
                onChange={(event) => {
                  setObjectUri(event.target.value);
                  setObjectUriError(null);
                }}
                placeholder="rnet://object/…"
                typography="mono"
              />
            </label>
            <Button type="submit" variant="secondary" disabled={!objectUri.trim() || add.isPending}>
              {add.isPending ? "Adding…" : "Add object"}
            </Button>
          </form>
          {objectUriError ? (
            <InlineError id={objectUriErrorId}>{objectUriError}</InlineError>
          ) : null}
          {add.isError ? <Failed error={add.error} /> : null}
          {remove.isError ? <Failed error={remove.error} /> : null}
          <Button
            variant="secondary"
            className="self-start"
            aria-expanded={importExpanded}
            aria-controls={importPanelId}
            onClick={() => setImportExpanded((expanded) => !expanded)}
          >
            Import into this Vibe
          </Button>
          <div id={importPanelId} hidden={!importExpanded}>
            <ImportPanel
              vibeUuid={uuid}
              configuredSources={vibe.data.pull?.enabled ? (vibe.data.pull.sources ?? []) : []}
              sourceConnectionReturn={sourceConnectionReturn}
            />
          </div>
        </div>
      ) : null}

      {vibe.data && objects.data ? (
        <InferredVibeView
          objects={objects.data}
          vibe={vibe.data}
          openObject={(object) => open({ kind: "object", uuid: uuidOf(object.uri) })}
          removePending={remove.isPending}
          removeObject={
            isOwner
              ? (object) =>
                  remove.mutate({ params: { path: { id: uuid } }, body: { objects: [object.uri] } })
              : undefined
          }
        />
      ) : null}

      {objects.isPending ? <Pending label="objects" /> : null}
      {objects.isError ? <Failed error={objects.error} /> : null}
      {objects.data?.length === 0 ? (
        <span className="text-body text-tertiary">This Vibe has no objects yet.</span>
      ) : null}
      {objects.data?.length && (!vibe.data || !inferredVibeView(vibe.data)) ? (
        <section aria-labelledby="media-objects-heading" className="mb-8 flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="media-objects-heading" className="text-label text-primary">
              Objects
            </h2>
            <span className="text-caption text-tertiary">
              {objects.data.length} {objects.data.length === 1 ? "object" : "objects"}
            </span>
          </div>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {objects.data.map((object, index) => (
              <MediaObjectEntry
                key={`${object.uri}:${index}`}
                title={mediaObjectDisplayName(object)}
                object={object}
                openObject={() => open({ kind: "object", uuid: uuidOf(object.uri) })}
                removePending={remove.isPending}
                removeObject={
                  isOwner
                    ? () =>
                        remove.mutate({
                          params: { path: { id: uuid } },
                          body: { objects: [object.uri] },
                        })
                    : undefined
                }
              />
            ))}
          </ul>
        </section>
      ) : null}
      {vibe.data && objects.data && isOwner ? (
        <PushControl objects={objects.data} vibeUuid={uuid} />
      ) : null}
    </StoreSurface>
  );
}
