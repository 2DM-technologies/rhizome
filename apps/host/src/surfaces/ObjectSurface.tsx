import { useState, type ReactNode } from "react";

import { uuidOf } from "../api/uris.ts";
import {
  useMediaElement,
  useMediaObject,
  useOriginArtifact,
  usePayloadUrl,
  useSetMediaObjectUser,
} from "../queries/index.ts";
import { useSession } from "../session/session.ts";
import { Button, StatusChip } from "../ui/index.ts";
import { payloadPresentation } from "./payloadPresentation.ts";
import { Failed, Pending, StoreSurface } from "./provisional.tsx";

function GraphSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-md bg-surface p-5">
      <h2 className="text-label text-primary">{title}</h2>
      {children}
    </section>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-canvas p-3 font-mono text-caption text-secondary">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function OriginArtifactReference({ uri }: { uri: string }) {
  const origin = useOriginArtifact(uuidOf(uri));

  return (
    <li className="flex flex-col gap-2 rounded-sm border border-hairline p-3">
      <div className="flex min-w-0 items-center gap-2">
        <StatusChip status="neutral">origin artifact</StatusChip>
        <code className="min-w-0 flex-1 truncate text-caption text-secondary">{uri}</code>
      </div>
      {origin.isPending ? <Pending label="origin" /> : null}
      {origin.isError ? <Failed error={origin.error} /> : null}
      {origin.data ? (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-caption">
          <dt className="text-tertiary">Label</dt>
          <dd className="text-secondary">{origin.data.label ?? "—"}</dd>
          <dt className="text-tertiary">MIME</dt>
          <dd className="text-secondary">{origin.data.mime}</dd>
          <dt className="text-tertiary">Bytes</dt>
          <dd className="text-secondary">{origin.data.byte_size ?? "—"}</dd>
          <dt className="text-tertiary">Hash</dt>
          <dd className="break-all font-mono text-secondary">{origin.data.content_hash}</dd>
        </dl>
      ) : null}
    </li>
  );
}

function OriginReference({ uri, inspectArtifact }: { uri: string; inspectArtifact: boolean }) {
  const artifact = uri.startsWith("rnet://origin/");
  if (artifact && inspectArtifact) return <OriginArtifactReference uri={uri} />;
  return (
    <li className="flex min-w-0 items-center gap-2 rounded-sm border border-hairline p-3">
      <StatusChip status="neutral">{artifact ? "origin artifact" : "client"}</StatusChip>
      <code className="min-w-0 flex-1 truncate text-caption text-secondary">{uri}</code>
    </li>
  );
}

function RenderedPayload({ uri, uuid, mime }: { uri: string; uuid: string; mime: string }) {
  const payload = usePayloadUrl("elements", uuid);
  const presentation = payloadPresentation(mime);

  if (payload.isPending) return <Pending label="payload" />;
  if (payload.isError) return <Failed error={payload.error} />;
  if (!payload.data) return null;

  const label = `Payload for ${uri}`;
  let rendered: ReactNode = null;
  switch (presentation) {
    case "image":
      rendered = (
        <img
          src={payload.data}
          alt={label}
          className="max-h-96 max-w-full rounded-sm object-contain"
        />
      );
      break;
    case "audio":
      rendered = <audio src={payload.data} controls aria-label={label} className="w-full" />;
      break;
    case "video":
      rendered = (
        <video
          src={payload.data}
          controls
          aria-label={label}
          className="max-h-96 w-full rounded-sm bg-black"
        />
      );
      break;
    case "text":
      rendered = (
        <iframe
          src={payload.data}
          title={label}
          sandbox=""
          style={{ colorScheme: "light" }}
          className="h-72 w-full rounded-sm border border-hairline bg-white"
        />
      );
      break;
    case "document":
      rendered = (
        <iframe
          src={payload.data}
          title={label}
          sandbox=""
          className="h-72 w-full rounded-sm border border-hairline bg-white"
        />
      );
      break;
    case "download":
      rendered = (
        <span className="text-body text-tertiary">This payload has no browser-native preview.</span>
      );
      break;
  }

  return (
    <div className="flex flex-col items-start gap-3">
      {rendered}
      <a
        href={payload.data}
        download={`element-${uuid}`}
        aria-label={`Download payload ${uri}`}
        className="text-label text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
      >
        Download payload
      </a>
    </div>
  );
}

function MediaElementReference({ uri, position }: { uri: string; position: number }) {
  const uuid = uuidOf(uri);
  const element = useMediaElement(uuid);

  return (
    <li className="flex flex-col gap-3 rounded-sm border border-hairline p-4">
      <div className="flex min-w-0 items-center gap-2">
        <StatusChip status="neutral">{`element ${position + 1}`}</StatusChip>
        <code className="min-w-0 flex-1 truncate text-caption text-secondary">{uri}</code>
      </div>
      {element.isPending ? <Pending label="element" /> : null}
      {element.isError ? <Failed error={element.error} /> : null}
      {element.data ? (
        <>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-caption">
            <dt className="text-tertiary">Kind</dt>
            <dd className="text-secondary">{element.data.kind}</dd>
            <dt className="text-tertiary">MIME</dt>
            <dd className="text-secondary">{element.data.mime}</dd>
            <dt className="text-tertiary">Bytes</dt>
            <dd className="text-secondary">{element.data.byte_size ?? "—"}</dd>
            <dt className="text-tertiary">Hash</dt>
            <dd className="break-all font-mono text-secondary">{element.data.content_hash}</dd>
          </dl>
          <RenderedPayload uri={uri} uuid={uuid} mime={element.data.mime} />
        </>
      ) : null}
    </li>
  );
}

/** Store-backed object graph and last-write-wins user-property editor. */
export function ObjectSurface({ uuid }: { uuid: string }) {
  const object = useMediaObject(uuid);
  const save = useSetMediaObjectUser();
  const session = useSession();
  const [draft, setDraft] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [submittedDraft, setSubmittedDraft] = useState<string | null>(null);

  const stored = object.data?.user?.properties ?? {};
  const text = draft ?? JSON.stringify(stored, null, 2);
  // M1.5 has no effective-capabilities response. Fail closed for non-owners until the Store can
  // distinguish a read-only grant from a delegated `write:user` grant.
  const isOwner = object.data?.owner === session.data?.user.id;

  function submit() {
    if (!object.data) return;
    let properties: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        setParseError("User properties must be a JSON object.");
        return;
      }
      properties = parsed as Record<string, unknown>;
      setParseError(null);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Invalid JSON.");
      return;
    }
    const submitted = text;
    setSubmittedDraft(submitted);
    save.mutate(
      {
        params: { path: { id: uuid } },
        body: { properties },
      },
      // Re-sync only if the user has not typed a newer draft while this write was in flight.
      { onSuccess: () => setDraft((current) => (current === submitted ? null : current)) },
    );
  }

  return (
    <StoreSurface title={object.data?.type ?? "Object"} detail={object.data?.uri}>
      {object.isPending ? <Pending label="object" /> : null}
      {object.isError ? <Failed error={object.error} /> : null}

      {object.data ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-5">
            <GraphSection title="Source">
              <JsonBlock value={object.data.source} />
            </GraphSection>

            <GraphSection title="User">
              {isOwner ? (
                <>
                  <div className="flex items-center gap-3">
                    {save.isSuccess && draft === null ? (
                      <StatusChip status="success">saved</StatusChip>
                    ) : null}
                  </div>

                  <textarea
                    value={text}
                    onChange={(event) => {
                      setDraft(event.target.value);
                      setParseError(null);
                    }}
                    spellCheck={false}
                    rows={14}
                    aria-label="User properties, as JSON"
                    className="w-full rounded-sm border border-hairline bg-canvas p-3 font-mono text-caption text-primary outline-none focus-visible:outline-2 focus-visible:outline-accent"
                  />

                  <div className="flex flex-wrap items-center gap-3">
                    <Button onClick={submit} disabled={save.isPending || draft === null}>
                      {save.isPending ? "Saving…" : "Save user properties"}
                    </Button>
                    {draft !== null ? (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setDraft(null);
                          setParseError(null);
                        }}
                      >
                        Discard
                      </Button>
                    ) : null}
                    {parseError ? <span className="text-body text-error">{parseError}</span> : null}
                    {save.isError && draft === submittedDraft ? (
                      <Failed error={save.error} />
                    ) : null}
                  </div>
                </>
              ) : (
                <JsonBlock value={stored} />
              )}
            </GraphSection>

            <GraphSection title="Inferred">
              <JsonBlock value={object.data.inferred ?? {}} />
            </GraphSection>
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <GraphSection title={`Elements (${object.data.elements.length})`}>
              {object.data.elements.length ? (
                <ol className="flex flex-col gap-3">
                  {object.data.elements.map((uri, position) => (
                    <MediaElementReference
                      key={`${uri}:${position}`}
                      uri={uri}
                      position={position}
                    />
                  ))}
                </ol>
              ) : (
                <span className="text-body text-tertiary">This object has no media elements.</span>
              )}
            </GraphSection>
            <GraphSection title="Keys">
              <JsonBlock value={object.data.keys ?? {}} />
            </GraphSection>
            <GraphSection title="Origins">
              <ul className="flex flex-col gap-3">
                {object.data.source.origins.map((uri, position) => (
                  <OriginReference key={`${uri}:${position}`} uri={uri} inspectArtifact={isOwner} />
                ))}
              </ul>
            </GraphSection>
          </div>
        </div>
      ) : null}
    </StoreSurface>
  );
}
