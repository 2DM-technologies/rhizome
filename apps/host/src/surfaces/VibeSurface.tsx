import { useId, useState, type FormEvent } from "react";
import { rnetUriPattern } from "@rnet/types/patterns";

import {
  useAddVibeObjects,
  useDeleteVibe,
  useRemoveVibeObjects,
  useUpdateVibe,
  useVibe,
  useVibeObjects,
} from "../queries/index.ts";
import { useSession } from "../session/session.ts";
import { useSurfaceNavigation } from "../shell/focus.ts";
import { uuidOf } from "../api/uris.ts";
import { Button } from "../ui/index.ts";
import { surfaceId } from "../shell/surfaces.ts";
import { Failed, Pending, StoreSurface } from "./provisional.tsx";

const OBJECT_URI = new RegExp(rnetUriPattern("object"));

export function VibeSurface({ uuid }: { uuid: string }) {
  const vibe = useVibe(uuid);
  const objects = useVibeObjects(uuid);
  const update = useUpdateVibe();
  const remove = useRemoveVibeObjects();
  const add = useAddVibeObjects();
  const deleteVibe = useDeleteVibe();
  const session = useSession();
  const { open, close } = useSurfaceNavigation();
  const objectUriErrorId = useId();
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [objectUri, setObjectUri] = useState("");
  const [objectUriError, setObjectUriError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const title = titleDraft ?? vibe.data?.title ?? "";
  const isOwner = vibe.data?.owner === session.data?.user.id;

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
          <form onSubmit={rename} className="flex max-w-2xl items-center gap-3">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Vibe title</span>
              <input
                aria-label="Vibe title"
                value={title}
                onChange={(event) => setTitleDraft(event.target.value)}
                maxLength={256}
                className="w-full rounded-pill border border-hairline bg-surface px-5 py-3 text-body text-primary outline-none focus-visible:outline-2 focus-visible:outline-accent"
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

          <form onSubmit={addObject} className="flex max-w-2xl items-center gap-3">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Object URI</span>
              <input
                aria-label="Object URI"
                aria-invalid={objectUriError ? true : undefined}
                aria-describedby={objectUriError ? objectUriErrorId : undefined}
                value={objectUri}
                onChange={(event) => {
                  setObjectUri(event.target.value);
                  setObjectUriError(null);
                }}
                placeholder="rnet://object/…"
                className="w-full rounded-pill border border-hairline bg-surface px-5 py-3 font-mono text-caption text-primary outline-none placeholder:text-tertiary focus-visible:outline-2 focus-visible:outline-accent"
              />
            </label>
            <Button type="submit" variant="secondary" disabled={!objectUri.trim() || add.isPending}>
              {add.isPending ? "Adding…" : "Add object"}
            </Button>
          </form>
          {objectUriError ? (
            <span id={objectUriErrorId} role="alert" className="text-body text-error">
              {objectUriError}
            </span>
          ) : null}
          {add.isError ? <Failed error={add.error} /> : null}
          {remove.isError ? <Failed error={remove.error} /> : null}
        </div>
      ) : null}

      {objects.isPending ? <Pending label="objects" /> : null}
      {objects.isError ? <Failed error={objects.error} /> : null}
      {objects.data?.length === 0 ? (
        <span className="text-body text-tertiary">This Vibe has no objects yet.</span>
      ) : null}
      <ul className="flex flex-col">
        {objects.data?.map((object, index) => (
          <li
            key={`${object.uri}:${index}`}
            className="flex items-center gap-3 border-b border-[rgba(20,20,26,0.06)]"
          >
            <button
              type="button"
              onClick={() => open({ kind: "object", uuid: uuidOf(object.uri) })}
              aria-label={`Open object ${object.uri}`}
              className="flex min-w-0 flex-1 items-baseline gap-3 py-3 text-left"
            >
              <span className="text-mono-label text-tertiary">{object.type}</span>
              <span className="min-w-0 flex-1 truncate text-label text-primary">{object.uri}</span>
              <span className="text-caption text-tertiary">{object.elements.length} elements</span>
            </button>
            {isOwner ? (
              <Button
                variant="ghost"
                aria-label={`Remove ${object.uri} from Vibe`}
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate({
                    params: { path: { id: uuid } },
                    body: { objects: [object.uri] },
                  })
                }
              >
                Remove
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </StoreSurface>
  );
}
