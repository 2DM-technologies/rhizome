import { useQueries } from "@tanstack/react-query";
import type { MediaElement, MediaObject } from "@rnet/types";

import { api } from "../api/client.ts";
import { useNearViewport } from "../ui/useNearViewport.ts";
import { uuidOf } from "../api/uris.ts";
import { usePayloadUrl } from "../queries/index.ts";
import {
  Badge,
  Button,
  Card,
  ElementPreview,
  EntityRow,
  primaryPayloadCandidate,
} from "../ui/index.ts";

const MEDIA_ELEMENT_PATH = "/rnet/v0/elements/{id}";

interface ResolvedObjectElement {
  element: MediaElement;
  index: number;
  reference: MediaObject["elements"][number];
  role?: MediaObject["elements"][number]["role"];
  uuid: string;
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

export function MediaObjectEntry({
  caption,
  title,
  object,
  openObject,
  removeObject,
  removePending,
}: {
  caption?: string;
  title: string;
  object: MediaObject;
  openObject: () => void;
  removeObject?: () => void;
  removePending?: boolean;
}) {
  const kindLabel = objectKindLabel(object);
  const destination = sourceDestination(object);
  const canRemoveFromCard = Boolean(removeObject) && object.source.ingest.method === "authored";
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
          subtitle={caption}
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
            title={primaryElement?.element.alt ?? title}
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
          {caption ? <span className="text-caption text-tertiary">{caption}</span> : null}
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
