import type { MediaObjectElementRef } from "@rnet/types";
import { useState } from "react";

import { uuidOf } from "../api/uris.ts";
import {
  useMediaElement,
  useMediaObject,
  useOriginArtifact,
  usePayloadUrl,
  useSetMediaObjectUser,
} from "../queries/index.ts";
import { useSession } from "../session/session.ts";
import {
  Button,
  CodeBlock,
  ElementPreview,
  InlineError,
  MetadataList,
  ReferenceCard,
  SectionCard,
  StatusChip,
  TextArea,
  TextLink,
} from "../ui/index.ts";
import { Failed, Pending, StoreSurface } from "./provisional.tsx";

function JsonBlock({ value }: { value: unknown }) {
  return <CodeBlock className="max-h-72">{JSON.stringify(value, null, 2)}</CodeBlock>;
}

function OriginArtifactReference({ uri }: { uri: string }) {
  const origin = useOriginArtifact(uuidOf(uri));

  return (
    <ReferenceCard label="origin artifact" reference={uri}>
      {origin.isPending ? <Pending label="origin" /> : null}
      {origin.isError ? <Failed error={origin.error} /> : null}
      {origin.data ? (
        <MetadataList
          items={[
            { term: "Label", value: origin.data.label ?? "—" },
            { term: "MIME", value: origin.data.mime },
            { term: "Bytes", value: origin.data.byte_size ?? "—" },
            { term: "Hash", value: origin.data.content_hash, mono: true },
          ]}
        />
      ) : null}
    </ReferenceCard>
  );
}

function OriginReference({ uri, inspectArtifact }: { uri: string; inspectArtifact: boolean }) {
  const artifact = uri.startsWith("rnet://origin/");
  if (artifact && inspectArtifact) return <OriginArtifactReference uri={uri} />;
  return <ReferenceCard label={artifact ? "origin artifact" : "client"} reference={uri} compact />;
}

function RenderedPayload({
  uri,
  uuid,
  kind,
  mime,
  alt,
}: {
  uri: string;
  uuid: string;
  kind: string;
  mime: string;
  alt?: string;
}) {
  const payload = usePayloadUrl("elements", uuid);

  if (payload.isPending) return <Pending label="payload" />;
  if (payload.isError) return <Failed error={payload.error} />;
  if (!payload.data) return null;

  const label = `Payload for ${uri}`;
  return (
    <div className="flex flex-col items-start gap-3">
      <ElementPreview
        title={alt ?? label}
        kind={kind}
        mime={mime}
        src={payload.data}
        variant="detail"
        className="!rounded-none !border-black/10"
      />
      <TextLink
        href={payload.data}
        download={`element-${uuid}`}
        aria-label={`Download payload ${uri}`}
        size="label"
      >
        Download payload
      </TextLink>
    </div>
  );
}

function MediaElementReference({
  reference,
  position,
}: {
  reference: MediaObjectElementRef;
  position: number;
}) {
  const { uri } = reference;
  const uuid = uuidOf(uri);
  const element = useMediaElement(uuid);

  return (
    <ReferenceCard label={`element ${position + 1}`} reference={uri}>
      {element.isPending ? <Pending label="element" /> : null}
      {element.isError ? <Failed error={element.error} /> : null}
      {element.data ? (
        <>
          <MetadataList
            items={[
              { term: "Role", value: reference.role ?? "—" },
              { term: "Alt", value: element.data.alt ?? "—" },
              { term: "Kind", value: element.data.kind },
              { term: "MIME", value: element.data.mime },
              { term: "Bytes", value: element.data.byte_size ?? "—" },
              { term: "Hash", value: element.data.content_hash, mono: true },
            ]}
          />
          <RenderedPayload
            uri={uri}
            uuid={uuid}
            kind={element.data.kind}
            mime={element.data.mime}
            {...(element.data.alt !== undefined ? { alt: element.data.alt } : {})}
          />
          <div className="flex min-w-0 flex-col gap-3">
            <h3 className="text-label text-primary">Inferred</h3>
            <JsonBlock value={element.data.inferred ?? {}} />
          </div>
        </>
      ) : null}
    </ReferenceCard>
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
            <SectionCard title="Inferred">
              <JsonBlock value={object.data.inferred ?? {}} />
            </SectionCard>

            <SectionCard title="User">
              {isOwner ? (
                <>
                  <div className="flex items-center gap-3">
                    {save.isSuccess && draft === null ? (
                      <StatusChip status="success">saved</StatusChip>
                    ) : null}
                  </div>

                  <TextArea
                    value={text}
                    onChange={(event) => {
                      setDraft(event.target.value);
                      setParseError(null);
                    }}
                    spellCheck={false}
                    rows={14}
                    aria-label="User properties, as JSON"
                    bordered={false}
                    tone="canvas"
                    typography="mono"
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
                    {parseError ? <InlineError>{parseError}</InlineError> : null}
                    {save.isError && draft === submittedDraft ? (
                      <Failed error={save.error} />
                    ) : null}
                  </div>
                </>
              ) : (
                <JsonBlock value={stored} />
              )}
            </SectionCard>

            <SectionCard title="Source">
              <JsonBlock value={object.data.source} />
            </SectionCard>
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <SectionCard title={`Elements (${object.data.elements.length})`}>
              {object.data.elements.length ? (
                <ol className="flex flex-col gap-3">
                  {object.data.elements.map((reference, position) => (
                    <MediaElementReference
                      key={`${reference.uri}:${position}`}
                      reference={reference}
                      position={position}
                    />
                  ))}
                </ol>
              ) : (
                <span className="text-body text-tertiary">This object has no media elements.</span>
              )}
            </SectionCard>
            <SectionCard title="Keys">
              <JsonBlock value={object.data.keys ?? {}} />
            </SectionCard>
            <SectionCard title="Origins">
              <ul className="flex flex-col gap-3">
                {object.data.source.origins.map((uri, position) => (
                  <OriginReference key={`${uri}:${position}`} uri={uri} inspectArtifact={isOwner} />
                ))}
              </ul>
            </SectionCard>
          </div>
        </div>
      ) : null}
    </StoreSurface>
  );
}
