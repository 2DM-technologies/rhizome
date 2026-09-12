import { useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import type { MediaElement, MediaObject } from "@rnet/types";

import { api } from "../api/client.ts";
import { uuidOf } from "../api/uris.ts";
import { usePayloadUrl } from "../queries/index.ts";
import { pathOf } from "../shell/surfaces.ts";
import { ElementPreview } from "../ui/index.ts";
import { useNearViewport } from "../ui/useNearViewport.ts";
import { httpLink, newestTweets, tweetTextParts } from "./tweetfeed.ts";

interface Props {
  objects: MediaObject[];
  openObject: (object: MediaObject) => void;
  removeObject?: (object: MediaObject) => void;
  removePending?: boolean;
}

const linkStyle =
  "text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent";
const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function TweetFeed({ objects, ...actions }: Props) {
  return (
    <ul aria-label="Tweet feed" className="mx-auto w-full max-w-[42rem] divide-y divide-hairline">
      {newestTweets(objects).map(({ object, position, date }) => (
        <Tweet key={`${object.uri}:${position}`} object={object} date={date} {...actions} />
      ))}
    </ul>
  );
}

function Tweet({
  object,
  date,
  openObject,
  removeObject,
  removePending,
}: Omit<Props, "objects"> & {
  object: MediaObject;
  date: Date | undefined;
}) {
  const viewport = useNearViewport();
  const properties = object.source.properties;
  const handle =
    typeof properties.author_handle === "string" ? properties.author_handle : undefined;
  const name =
    typeof properties.author_name === "string" && properties.author_name.trim()
      ? properties.author_name
      : handle || "Unknown author";
  const original = httpLink(object.keys?.canonical_url);
  const quote =
    properties.post_kind === "quote" ? httpLink(object.keys?.x_quoted_tweet_url) : undefined;

  return (
    <li ref={viewport.ref} data-tweet-object={object.uri} className="min-w-0 py-6 first:pt-0">
      <article className="flex min-w-0 gap-3 sm:gap-4" aria-label={`Post by ${name}`}>
        <span
          aria-hidden="true"
          className="hidden size-10 shrink-0 items-center justify-center rounded-full bg-surface text-label text-secondary sm:flex"
        >
          {Array.from(name.trim())[0]?.toUpperCase() ?? "?"}
        </span>
        <div className="min-w-0 flex-1">
          <header className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 break-words">
            <span className="min-w-0 text-label text-primary">{name}</span>
            {handle ? (
              <span className="min-w-0 text-caption text-tertiary">
                @{handle.replace(/^@/u, "")}
              </span>
            ) : null}
            {date ? (
              <time
                dateTime={date.toISOString()}
                title={date.toLocaleString()}
                className="text-caption text-tertiary"
              >
                {dateFormat.format(date)}
              </time>
            ) : null}
          </header>
          {viewport.active ? (
            <TweetContent object={object} />
          ) : (
            <p className="min-h-20 text-caption text-tertiary">Loading post…</p>
          )}
          {quote ? (
            <a
              href={quote}
              target="_blank"
              rel="noopener noreferrer"
              className={`${linkStyle} mt-4 block rounded-sm border border-hairline px-4 py-3 text-caption`}
            >
              View quoted post ↗
            </a>
          ) : null}
          <footer className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-caption">
            <a
              href={pathOf({ kind: "object", uuid: uuidOf(object.uri) })}
              className={linkStyle}
              aria-label={`Open object ${object.uri}`}
              onClick={(event) => {
                if (
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                openObject(object);
              }}
            >
              Open object
            </a>
            {original ? (
              <a href={original} target="_blank" rel="noopener noreferrer" className={linkStyle}>
                Original post ↗
              </a>
            ) : null}
            {removeObject && object.source.ingest.method === "authored" ? (
              <button
                type="button"
                className={linkStyle}
                aria-label={`Remove ${object.uri} from Vibe`}
                disabled={removePending}
                onClick={() => removeObject(object)}
              >
                Remove
              </button>
            ) : null}
          </footer>
        </div>
      </article>
    </li>
  );
}

function TweetContent({ object }: { object: MediaObject }) {
  const queries = useQueries({
    queries: object.elements.map(({ uri }) =>
      api.queryOptions("get", "/rnet/v0/elements/{id}", {
        params: { path: { id: uuidOf(uri) } },
      }),
    ),
  });
  // The tweet vocabulary defines the body as its first text/plain element.
  // Wait for metadata in order so an early attachment cannot replace the body.
  if (queries.some((query) => query.isPending))
    return <p className="min-h-20 text-caption text-tertiary">Loading post…</p>;
  const elements = queries.flatMap((query) => (query.data ? [query.data] : []));
  const body = elements.find((element) => element.kind === "text" && element.mime === "text/plain");
  const media = elements.filter((element) => element.kind === "image" || element.kind === "video");
  return (
    <>
      {body ? (
        <TweetText element={body} entities={object.source.properties.entities} />
      ) : (
        <p className="text-caption text-tertiary">Post text unavailable</p>
      )}
      {media.length ? (
        <div className={`mt-4 grid gap-2 ${media.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
          {media.map((element, index) => (
            <TweetMedia key={`${element.uri}:${index}`} element={element} />
          ))}
        </div>
      ) : null}
      {queries.some((query) => query.isError) ? (
        <p className="mt-3 text-caption text-tertiary">Some content is unavailable.</p>
      ) : null}
    </>
  );
}

function TweetText({ element, entities }: { element: MediaElement; entities: unknown }) {
  // Share the authenticated Blob cache with other payload surfaces.
  const payload = api.useQuery(
    "get",
    "/rnet/v0/elements/{id}/bytes",
    {
      params: { path: { id: uuidOf(element.uri) } },
      parseAs: "blob",
    },
    { gcTime: 0, staleTime: Number.POSITIVE_INFINITY, refetchOnWindowFocus: false },
  );
  const [decoded, setDecoded] = useState<{ blob: Blob; text?: string }>();
  useEffect(() => {
    const blob = payload.data;
    if (!blob) return;
    let cancelled = false;
    void blob
      .arrayBuffer()
      .then((bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes))
      .then(
        (text) => {
          if (!cancelled) setDecoded({ blob, text });
        },
        () => {
          if (!cancelled) setDecoded({ blob });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [payload.data]);
  const current = decoded?.blob === payload.data ? decoded : undefined;
  if (payload.isError || (current && current.text === undefined))
    return <p className="text-caption text-tertiary">Post text unavailable</p>;
  if (!current) return <p className="min-h-20 text-caption text-tertiary">Loading post…</p>;
  return (
    <p
      data-tweet-text
      className="whitespace-pre-wrap break-words text-body-lg leading-relaxed text-primary"
    >
      {tweetTextParts(current.text!, entities).map((part, index) =>
        part.href ? (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className={linkStyle}
          >
            {part.text}
          </a>
        ) : (
          part.text
        ),
      )}
    </p>
  );
}

function TweetMedia({ element }: { element: MediaElement }) {
  const payload = usePayloadUrl("elements", uuidOf(element.uri));
  return (
    <ElementPreview
      title={element.alt ?? "Post attachment"}
      kind={element.kind}
      mime={element.mime}
      src={payload.data}
      isError={payload.isError}
      isPending={payload.isPending}
      variant="detail"
      className="w-full self-center"
    />
  );
}
