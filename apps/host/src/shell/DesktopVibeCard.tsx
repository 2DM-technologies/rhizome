import type { MediaObject, Vibe } from "@rnet/types";
import { useEffect, useMemo, useState } from "react";

import { uuidOf } from "../api/uris.ts";
import { ProceduralVibeOrb } from "../orb/ProceduralVibeOrb.tsx";
import type { OrbVisualRecipe } from "../orb/recipe.ts";
import { orbVisualForVibe } from "../orb/vibeRecipe.ts";
import { useMediaElement, usePayloadUrl, useVibeObjects } from "../queries/index.ts";
import { vibeUpdatedAt } from "../vibeRecency.ts";
import { useSurfaceNavigation } from "./focus.ts";

const CARD_PREVIEW_LIMIT = 6;

function cardBackgroundColor(recipe: OrbVisualRecipe): string {
  const dominant = [...recipe.palette].sort(
    (left, right) => right.weight - left.weight || left.color.localeCompare(right.color),
  )[0]!;
  const tint = Math.round(14 + recipe.contrast * 8);
  return `color-mix(in srgb, ${dominant.color} ${tint}%, var(--rz-bg-canvas))`;
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
    <span
      data-object-thumbnail
      className="block size-5 shrink-0 overflow-hidden border border-neutral-border bg-canvas/60"
    >
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
  const previews = details.slice(0, CARD_PREVIEW_LIMIT);
  const source = details[0] ? objectSource(details[0]) : "Rhizome";
  const type = details[0] ? humanize(details[0].type) : undefined;
  const remaining = Math.max(0, vibe.objects.length - previews.length);
  const objectLabel = `${vibe.objects.length} ${vibe.objects.length === 1 ? "object" : "objects"}`;
  const updatedAge = relativeAge(vibeUpdatedAt(vibe), now);
  const visual = useMemo(() => {
    const orb = orbVisualForVibe(vibe);
    return {
      ...orb,
      backgroundColor: cardBackgroundColor(orb.recipe),
      backgroundSource: orb.loading ? "fallback" : "inferred",
    };
  }, [vibe]);
  const [orbActive, setOrbActive] = useState(false);

  return (
    <article
      data-desktop-vibe-card
      data-vibe-card-background={visual.backgroundSource}
      style={{ backgroundColor: visual.backgroundColor }}
      onPointerEnter={() => setOrbActive(true)}
      onPointerLeave={() => setOrbActive(false)}
      onFocusCapture={() => setOrbActive(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOrbActive(false);
      }}
      className="group relative h-[102px] min-h-0 min-w-0 overflow-hidden rounded-sm shadow-[0_2px_10px_rgb(20_21_26/4%)]"
    >
      <button
        type="button"
        className="absolute inset-0 z-10 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        aria-label={`Open Vibe ${vibe.title}`}
        onClick={() => navigation.open({ kind: "vibe", uuid })}
      />

      <div className="flex h-full min-h-0 min-w-0 flex-col px-2 py-[9px]">
        <div className="flex min-h-0 min-w-0 gap-2">
          <ProceduralVibeOrb
            recipe={visual.recipe}
            motion="interaction"
            active={orbActive}
            loading={visual.loading}
            size={44}
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
    </article>
  );
}
