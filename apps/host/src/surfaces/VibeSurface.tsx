import { useId, useState, type FormEvent } from "react";
import type { MediaObject } from "@rnet/types";
import { rnetUriPattern } from "@rnet/types/patterns";

import {
  useAddVibeObjects,
  useDeleteVibe,
  useMediaElement,
  usePayloadUrl,
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
import { ImportPanel } from "./ImportPanel.tsx";
import { payloadPresentation } from "./payloadPresentation.ts";

const OBJECT_URI = new RegExp(rnetUriPattern("object"));

function sourceTitle(object: MediaObject): string {
  const title = (object.source.properties as Record<string, unknown>).title;
  return typeof title === "string" && title.trim() ? title : "Untitled Are.na block";
}

function sourceProperty(object: MediaObject, key: string): string | undefined {
  const value = (object.source.properties as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function arenaBlockType(object: MediaObject): string {
  return sourceProperty(object, "arena_block_type") ?? "Block";
}

function arenaDestination(object: MediaObject): string | undefined {
  return (
    sourceProperty(object, "source_url") ??
    sourceProperty(object, "embed_url") ??
    sourceProperty(object, "attachment_url")
  );
}

function destinationHost(destination: string): string {
  try {
    return new URL(destination).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

function ArenaBlockPayload({
  blockType,
  destination,
  element,
  isError,
  isPending,
  payloadUrl,
  title,
}: {
  blockType: string;
  destination: string | undefined;
  element: { kind: string; mime: string } | undefined;
  isError: boolean;
  isPending: boolean;
  payloadUrl: string | undefined;
  title: string;
}) {
  if (!element) {
    if (isPending) {
      return <span className="text-caption text-tertiary">Loading block…</span>;
    }
    if (isError) {
      return <span className="text-caption text-tertiary">Block unavailable</span>;
    }
    return (
      <span
        data-arena-block-presentation="link"
        className="flex max-w-[80%] flex-col items-center gap-2 text-center"
      >
        <span className="rounded-pill border border-hairline px-3 py-1 text-mono-label text-secondary">
          {blockType}
        </span>
        <span className="line-clamp-2 text-body text-primary">
          {destination ? destinationHost(destination) : "No stored payload"}
        </span>
      </span>
    );
  }

  const presentation = payloadPresentation(element.mime);
  if (!payloadUrl) {
    const label =
      presentation === "document" ? "document" : presentation === "text" ? "markdown" : "media";
    return (
      <span className="text-caption text-tertiary">
        {isError ? `${label[0]?.toUpperCase()}${label.slice(1)} unavailable` : `Loading ${label}…`}
      </span>
    );
  }

  if (presentation === "image" && element.kind === "image") {
    return (
      <img
        data-arena-block-presentation="image"
        src={payloadUrl}
        alt={title}
        className="size-full object-contain transition-transform duration-300 group-hover:scale-[1.02]"
      />
    );
  }
  if (presentation === "text" && element.kind === "text") {
    return (
      <iframe
        data-arena-block-presentation="markdown"
        src={payloadUrl}
        title={`Markdown content for ${title}`}
        sandbox=""
        style={{ colorScheme: "light" }}
        className="size-full border-0 bg-white p-3"
      />
    );
  }
  if (presentation === "document" && element.kind === "document") {
    return (
      <iframe
        data-arena-block-presentation="document"
        src={payloadUrl}
        title={`PDF preview for ${title}`}
        className="size-full border-0 bg-white"
      />
    );
  }
  if (presentation === "audio" && element.kind === "audio") {
    return (
      <audio
        data-arena-block-presentation="audio"
        src={payloadUrl}
        controls
        aria-label={`Audio for ${title}`}
        className="w-[80%]"
      />
    );
  }
  if (presentation === "video" && element.kind === "video") {
    return (
      <video
        data-arena-block-presentation="video"
        src={payloadUrl}
        controls
        aria-label={`Video for ${title}`}
        className="size-full object-contain"
      />
    );
  }
  return (
    <span
      data-arena-block-presentation="download"
      className="flex max-w-[80%] flex-col items-center gap-2 text-center"
    >
      <span className="rounded-pill border border-hairline px-3 py-1 text-mono-label text-secondary">
        {blockType}
      </span>
      <span className="text-body text-primary">{element.mime}</span>
    </span>
  );
}

function ArenaBlockCard({ object, openObject }: { object: MediaObject; openObject: () => void }) {
  const firstElementUri = object.elements[0];
  const secondElementUri = object.elements[1];
  const firstElementUuid = firstElementUri ? uuidOf(firstElementUri) : undefined;
  const secondElementUuid = secondElementUri ? uuidOf(secondElementUri) : undefined;
  const firstElement = useMediaElement(firstElementUuid);
  const secondElement = useMediaElement(secondElementUuid);
  const primaryElement = [
    {
      query: firstElement,
      title: firstElement.data?.kind === "text" && firstElement.data.mime === "text/plain",
      uuid: firstElementUuid,
    },
    { query: secondElement, title: false, uuid: secondElementUuid },
  ].find(({ query, title: titleElement }) => query.data && !titleElement);
  const payload = usePayloadUrl(
    "elements",
    primaryElement?.query.data ? primaryElement.uuid : undefined,
  );
  const elementPending = Boolean(
    (firstElementUri && firstElement.isPending) || (secondElementUri && secondElement.isPending),
  );
  const elementError = Boolean(
    (firstElementUri && firstElement.isError) || (secondElementUri && secondElement.isError),
  );
  const title = sourceTitle(object);
  const blockType = arenaBlockType(object);
  const destination = arenaDestination(object);

  return (
    <li className="min-w-0">
      <article className="group flex h-full w-full flex-col overflow-hidden rounded-card border border-hairline bg-surface text-left transition-transform hover:-translate-y-0.5">
        <span className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-canvas">
          <ArenaBlockPayload
            blockType={blockType}
            destination={destination}
            element={primaryElement?.query.data}
            isError={elementError || payload.isError}
            isPending={elementPending}
            payloadUrl={payload.data}
            title={title}
          />
        </span>
        <span className="flex min-h-20 flex-col gap-1 px-4 py-3">
          <span className="flex items-center justify-between gap-3 text-mono-label text-tertiary">
            <span>{blockType}</span>
            {primaryElement?.query.data ? (
              <span className="truncate">{primaryElement.query.data.mime}</span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={openObject}
            aria-label={`Open Are.na block ${title}`}
            className="line-clamp-2 text-left text-label text-primary focus-visible:outline-2 focus-visible:outline-accent"
          >
            {title}
          </button>
          {destination ? (
            <a
              href={destination}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open source for ${title}`}
              className="mt-auto w-fit text-caption text-secondary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {destinationHost(destination)} ↗
            </a>
          ) : null}
        </span>
      </article>
    </li>
  );
}

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
  const arenaObjects = objects.data?.filter((object) => object.type === "arena.block") ?? [];

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
          <form onSubmit={rename} className="flex max-w-[42rem] items-center gap-3">
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

          <form onSubmit={addObject} className="flex max-w-[42rem] items-center gap-3">
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
          <ImportPanel
            vibeUuid={uuid}
            hasConfiguredSources={Boolean(
              vibe.data.pull?.enabled && vibe.data.pull.sources?.length,
            )}
          />
        </div>
      ) : null}

      {objects.isPending ? <Pending label="objects" /> : null}
      {objects.isError ? <Failed error={objects.error} /> : null}
      {objects.data?.length === 0 ? (
        <span className="text-body text-tertiary">This Vibe has no objects yet.</span>
      ) : null}
      {arenaObjects.length ? (
        <section aria-labelledby="arena-blocks-heading" className="mb-8 flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="arena-blocks-heading" className="text-label text-primary">
              Are.na blocks
            </h2>
            <span className="text-caption text-tertiary">
              {arenaObjects.length} {arenaObjects.length === 1 ? "block" : "blocks"}
            </span>
          </div>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {arenaObjects.map((object) => (
              <ArenaBlockCard
                key={object.uri}
                object={object}
                openObject={() => open({ kind: "object", uuid: uuidOf(object.uri) })}
              />
            ))}
          </ul>
        </section>
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
