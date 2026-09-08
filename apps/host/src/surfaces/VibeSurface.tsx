import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useQueries } from "@tanstack/react-query";
import type { MediaElement, MediaObject } from "@rnet/types";
import { rnetUriPattern } from "@rnet/types/patterns";

import {
  useAddVibeObjects,
  useDeleteVibe,
  usePayloadUrl,
  useRemoveVibeObjects,
  useUpdateVibe,
  useVibe,
  useVibeObjects,
} from "../queries/index.ts";
import { api } from "../api/client.ts";
import { mediaObjectDisplayName } from "../mediaObjectDisplayName.ts";
import { useSession } from "../session/session.ts";
import { useSurfaceNavigation } from "../shell/focus.ts";
import { uuidOf } from "../api/uris.ts";
import {
  Badge,
  Button,
  Card,
  ElementPreview,
  EntityRow,
  InlineError,
  TextInput,
  primaryPayloadCandidate,
} from "../ui/index.ts";
import { surfaceId } from "../shell/surfaces.ts";
import { Failed, Pending, StoreSurface } from "./provisional.tsx";
import { ImportPanel } from "./ImportPanel.tsx";
import { useSourceConnectionReturn } from "./sourceConnectionReturn.ts";

const OBJECT_URI = new RegExp(rnetUriPattern("object"));
const MEDIA_ELEMENT_PATH = "/rnet/v0/elements/{id}";

interface ResolvedObjectElement {
  element: MediaElement;
  index: number;
  reference: MediaObject["elements"][number];
  role?: MediaObject["elements"][number]["role"];
  uuid: string;
}

const cardActivators = new WeakMap<Element, () => void>();
let cardObserver: IntersectionObserver | undefined;

function nearViewportObserver(): IntersectionObserver | undefined {
  if (typeof IntersectionObserver === "undefined") return undefined;
  cardObserver ??= new IntersectionObserver(
    (entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        cardActivators.get(entry.target)?.();
        cardActivators.delete(entry.target);
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "320px 0px" },
  );
  return cardObserver;
}

function useNearViewport() {
  const ref = useRef<HTMLLIElement>(null);
  const [active, setActive] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    if (active) return;
    const element = ref.current;
    const observer = nearViewportObserver();
    if (!element || !observer) {
      setActive(true);
      return;
    }
    cardActivators.set(element, () => setActive(true));
    observer.observe(element);
    return () => {
      cardActivators.delete(element);
      observer.unobserve(element);
    };
  }, [active]);

  return { active, ref };
}

function sourceProperties(object: MediaObject): Record<string, unknown> {
  return object.source.properties as Record<string, unknown>;
}

function firstNonemptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function humanize(value: string): string {
  const words = value.replace(/[._-]+/g, " ").trim();
  return words ? `${words[0]?.toUpperCase()}${words.slice(1)}` : "Media object";
}

function objectKindLabel(object: MediaObject): string {
  const properties = sourceProperties(object);
  const namespacedType = Object.entries(properties).find(
    ([key, value]) => key.endsWith("_type") && typeof value === "string" && value.trim(),
  )?.[1];
  return (
    firstNonemptyString(
      properties.display_type,
      properties.kind,
      properties.type,
      namespacedType,
    ) ?? humanize(object.type)
  );
}

function httpDestination(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

function sourceDestination(object: MediaObject): string | undefined {
  const properties = sourceProperties(object);
  for (const key of ["source_url", "canonical_url", "url", "embed_url", "attachment_url"]) {
    const destination = httpDestination(properties[key]);
    if (destination) return destination;
  }
  for (const [key, value] of Object.entries(properties)) {
    if (!/(?:^|_)url$/.test(key)) continue;
    const destination = httpDestination(value);
    if (destination) return destination;
  }
  return undefined;
}

function destinationHost(destination: string): string {
  try {
    return new URL(destination).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

function MediaObjectPayload({
  destination,
  element,
  isError,
  isPending,
  kindLabel,
  payloadUrl,
  title,
}: {
  destination: string | undefined;
  element: MediaElement | undefined;
  isError: boolean;
  isPending: boolean;
  kindLabel: string;
  payloadUrl: string | undefined;
  title: string;
}) {
  return (
    <ElementPreview
      title={title}
      kind={element?.kind}
      mime={element?.mime}
      src={payloadUrl}
      isPending={isPending}
      isError={isError}
      fallbackLabel={kindLabel}
      fallbackDetail={destination ? destinationHost(destination) : "No stored payload"}
      frameTitle={
        element?.kind === "text"
          ? `${element.mime === "text/markdown" ? "Markdown" : "Text"} content for ${title}`
          : element?.kind === "document"
            ? `${element.mime === "application/pdf" ? "PDF" : "Document"} preview for ${title}`
            : undefined
      }
    />
  );
}

function MediaObjectEntry({
  isOwner,
  object,
  openObject,
  removeObject,
  removePending,
}: {
  isOwner: boolean;
  object: MediaObject;
  openObject: () => void;
  removeObject: () => void;
  removePending: boolean;
}) {
  const title = mediaObjectDisplayName(object);
  const kindLabel = objectKindLabel(object);
  const destination = sourceDestination(object);
  const canRemoveFromCard = isOwner && object.source.ingest.method === "authored";
  const viewport = useNearViewport();
  const elementQueries = useQueries({
    queries: object.elements.map(({ uri }) => ({
      ...api.queryOptions("get", MEDIA_ELEMENT_PATH, {
        params: { path: { id: uuidOf(uri) } },
      }),
      enabled: viewport.active,
    })),
  });
  const elements = elementQueries.flatMap((query, index): ResolvedObjectElement[] => {
    const element = query.data;
    const reference = object.elements[index];
    if (!element || !reference) return [];
    return [
      {
        element,
        index,
        reference,
        ...(reference.role ? { role: reference.role } : {}),
        uuid: uuidOf(reference.uri),
      },
    ];
  });
  // Select the payload only after every element's metadata has settled. Otherwise a lower-ranked
  // early response can start a large download and then be replaced when later metadata arrives.
  const metadataSettled = viewport.active && elementQueries.every((query) => !query.isPending);
  const primaryElement = metadataSettled ? primaryPayloadCandidate(elements) : undefined;
  const payload = usePayloadUrl("elements", primaryElement?.uuid);
  const elementPending =
    object.elements.length > 0 &&
    (!viewport.active || elementQueries.some((query) => query.isPending));
  const elementError = elementQueries.some((query) => query.isError);
  const hasRichPresentation = object.elements.length > 0 || Boolean(destination);

  if (!hasRichPresentation) {
    return (
      <li ref={viewport.ref} className="col-span-full">
        <EntityRow
          align="baseline"
          leading={<Badge>{object.type}</Badge>}
          title={title}
          meta="0 elements"
          onSelect={openObject}
          selectLabel={`Open object ${object.uri}`}
          trailing={
            canRemoveFromCard ? (
              <Button
                variant="ghost"
                aria-label={`Remove ${object.uri} from Vibe`}
                disabled={removePending}
                onClick={removeObject}
              >
                Remove
              </Button>
            ) : null
          }
        />
      </li>
    );
  }

  return (
    <li ref={viewport.ref} className="min-w-0" data-media-object-card>
      <Card
        as="article"
        padding="none"
        className="group flex h-full w-full flex-col overflow-hidden text-left transition-transform hover:-translate-y-0.5"
      >
        <span className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-canvas">
          <MediaObjectPayload
            destination={destination}
            element={primaryElement?.element}
            isError={elementError || payload.isError}
            isPending={elementPending}
            kindLabel={kindLabel}
            payloadUrl={payload.data}
            title={primaryElement?.reference.alt ?? title}
          />
        </span>
        <span className="flex min-h-20 flex-col gap-1 px-4 py-3">
          <span className="flex items-center justify-between gap-3 text-mono-label text-tertiary">
            <span>{kindLabel}</span>
            <span className="truncate text-right">
              {primaryElement ? `${primaryElement.element.mime} · ` : ""}
              {object.elements.length} {object.elements.length === 1 ? "element" : "elements"}
            </span>
          </span>
          <button
            type="button"
            onClick={openObject}
            aria-label={`Open object ${object.uri}`}
            className="line-clamp-2 text-left text-label text-primary focus-visible:outline-2 focus-visible:outline-accent"
          >
            {title}
          </button>
          {canRemoveFromCard ? (
            <span className="mt-auto flex justify-end pt-2">
              <Button
                variant="ghost"
                className="-mr-3 px-3 py-2"
                aria-label={`Remove ${object.uri} from Vibe`}
                disabled={removePending}
                onClick={removeObject}
              >
                Remove
              </Button>
            </span>
          ) : null}
        </span>
      </Card>
    </li>
  );
}

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
          <ImportPanel
            vibeUuid={uuid}
            configuredSources={vibe.data.pull?.enabled ? (vibe.data.pull.sources ?? []) : []}
            sourceConnectionReturn={sourceConnectionReturn}
          />
        </div>
      ) : null}

      {objects.isPending ? <Pending label="objects" /> : null}
      {objects.isError ? <Failed error={objects.error} /> : null}
      {objects.data?.length === 0 ? (
        <span className="text-body text-tertiary">This Vibe has no objects yet.</span>
      ) : null}
      {objects.data?.length ? (
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
                isOwner={isOwner}
                object={object}
                openObject={() => open({ kind: "object", uuid: uuidOf(object.uri) })}
                removePending={remove.isPending}
                removeObject={() =>
                  remove.mutate({
                    params: { path: { id: uuid } },
                    body: { objects: [object.uri] },
                  })
                }
              />
            ))}
          </ul>
        </section>
      ) : null}
    </StoreSurface>
  );
}
