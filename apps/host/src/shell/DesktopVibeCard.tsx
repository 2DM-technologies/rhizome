import type { MediaObject, Vibe } from "@rnet/types";
import { useEffect, useState } from "react";

import orbUser from "../assets/orbs/orb-user-24.png";
import { uuidOf } from "../api/uris.ts";
import { useMediaElement, usePayloadUrl, useVibeObjects } from "../queries/index.ts";
import { VibeOrb } from "../ui/index.ts";
import { vibeUpdatedAt } from "../vibeRecency.ts";
import { useSurfaceNavigation } from "./focus.ts";
import { markForSurface } from "./surfaceMarks.ts";

const CARD_BACKGROUNDS = [
  "var(--rz-vibe-card-1)",
  "var(--rz-vibe-card-2)",
  "var(--rz-vibe-card-3)",
  "var(--rz-vibe-card-4)",
  "var(--rz-vibe-card-5)",
] as const;

function stableIndex(value: string, length: number): number {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) % 997;
  return hash % length;
}

export function relativeAge(isoDate: string, now: number): string {
  const elapsed = Math.max(0, now - Date.parse(isoDate));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

function elementReference(object: MediaObject) {
  return (
    object.elements.find(({ role }) => role === "preview") ??
    object.elements.find(({ role }) => role === "content") ??
    object.elements[0]
  );
}

function payloadKind(mime: string | undefined): "image" | "video" | "text" | "other" {
  const mediaType = mime?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (mediaType.startsWith("image/")) return "image";
  if (mediaType.startsWith("video/")) return "video";
  if (
    mediaType.startsWith("text/") ||
    mediaType === "application/json" ||
    mediaType === "application/xml" ||
    mediaType === "application/javascript"
  ) {
    return "text";
  }
  return "other";
}

function TextThumbnail({ src }: { src: string }) {
  const [current, setCurrent] = useState<
    { src: string; status: "loaded"; text: string } | { src: string; status: "error" } | null
  >(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(src, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Text payload returned ${response.status}`);
        return response.text();
      })
      .then(
        (text) => {
          if (!controller.signal.aborted) setCurrent({ src, status: "loaded", text });
        },
        () => {
          if (!controller.signal.aborted) setCurrent({ src, status: "error" });
        },
      );
    return () => controller.abort();
  }, [src]);

  const state = current?.src === src ? current : null;
  return (
    <span
      data-element-presentation="text"
      className="block size-full overflow-hidden whitespace-pre-wrap break-all bg-canvas p-px font-mono text-[3px] leading-[1.05] text-primary"
    >
      {!state ? "" : state.status === "loaded" ? state.text : "Text"}
    </span>
  );
}

/** A deliberately tiny, inert object preview for the Figma thumbnail strip. */
function ObjectThumbnail({ object }: { object: MediaObject }) {
  const reference = elementReference(object);
  const elementUuid = reference ? uuidOf(reference.uri) : undefined;
  const element = useMediaElement(elementUuid);
  const payload = usePayloadUrl("elements", element.data ? elementUuid : undefined);
  const presentation = payloadKind(element.data?.mime);

  return (
    <span className="block size-[18px] shrink-0 overflow-hidden border border-neutral-border bg-canvas/60">
      {payload.data && presentation === "image" ? (
        <img
          src={payload.data}
          alt=""
          aria-hidden
          data-element-presentation="image"
          className="size-full object-cover"
        />
      ) : payload.data && presentation === "video" ? (
        <video
          src={payload.data}
          muted
          playsInline
          preload="metadata"
          aria-hidden
          data-element-presentation="video"
          className="size-full object-cover"
        />
      ) : payload.data && presentation === "text" ? (
        <TextThumbnail src={payload.data} />
      ) : (
        <span className="flex size-full items-center justify-center overflow-hidden text-[6px] font-medium uppercase leading-none text-secondary">
          {element.data?.kind?.slice(0, 1) ?? object.type.slice(0, 1)}
        </span>
      )}
    </span>
  );
}

function humanize(value: string): string {
  const label = value
    .replace(/[._-]+/g, " ")
    .replace(/@.+$/u, "")
    .trim();
  return label ? `${label[0]?.toUpperCase()}${label.slice(1)}` : value;
}

function objectSource(object: MediaObject): string {
  return humanize(object.source.ingest.skill ?? object.source.ingest.method);
}

/** Compact desktop-only Vibe tile from Figma 5034:1108; intentionally not the shared Card. */
export function DesktopVibeCard({ vibe, now }: { vibe: Vibe; now: number }) {
  const navigation = useSurfaceNavigation();
  const uuid = uuidOf(vibe.uri);
  const objects = useVibeObjects(uuid);
  const details = objects.data ?? [];
  const previews = details.slice(0, 5);
  const source = details[0] ? objectSource(details[0]) : "Rhizome";
  const type = details[0] ? humanize(details[0].type) : undefined;
  const remaining = Math.max(0, vibe.objects.length - previews.length);
  const objectLabel = `${vibe.objects.length} ${vibe.objects.length === 1 ? "object" : "objects"}`;
  const background = CARD_BACKGROUNDS[stableIndex(uuid, CARD_BACKGROUNDS.length)];
  const updatedAge = relativeAge(vibeUpdatedAt(vibe), now);

  return (
    <article
      data-desktop-vibe-card
      style={{ background }}
      className="group relative grid h-[102px] min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_4.25rem] overflow-hidden rounded-sm shadow-[0_2px_10px_rgb(20_21_26/4%)] transition-transform hover:-translate-y-px"
    >
      <button
        type="button"
        className="absolute inset-0 z-10 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        aria-label={`Open Vibe ${vibe.title}`}
        onClick={() => navigation.open({ kind: "vibe", uuid })}
      />

      <div className="flex min-h-0 min-w-0 flex-col p-2 pr-0">
        <div className="flex min-h-0 min-w-0 gap-2">
          <img
            src={orbUser}
            alt=""
            aria-hidden
            className="size-11 shrink-0 rounded-full object-cover [image-rendering:auto]"
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-1">
              <h3 className="truncate text-[18px] font-medium leading-[1.05] tracking-[-0.2px] text-primary">
                {vibe.title}
              </h3>
              <span
                data-vibe-updated-age
                aria-label={`Updated ${updatedAge}`}
                className="shrink-0 text-[10px] leading-none text-tertiary"
              >
                {updatedAge}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[10px] leading-tight text-secondary">
              {source}
              {type && type.toLocaleLowerCase() !== source.toLocaleLowerCase() ? ` · ${type}` : ""}
            </p>
          </div>
        </div>

        <div
          aria-label={objectLabel}
          className="mt-auto flex min-h-0 max-w-full items-center gap-0.5 overflow-hidden"
        >
          <span className="sr-only">{objectLabel}</span>
          {previews.map((object) => (
            <ObjectThumbnail key={object.uri} object={object} />
          ))}
          {remaining > 0 ? (
            <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-accent text-[8px] font-medium leading-none text-on-accent">
              +{remaining}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 items-center justify-center pr-2">
        <VibeOrb src={markForSurface({ kind: "vibe", uuid })} size="md" />
      </div>
    </article>
  );
}
