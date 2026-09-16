import type { MediaObject, Vibe } from "@rnet/types";
import { useEffect, useMemo, useState } from "react";

import { uuidOf } from "../api/uris.ts";
import { RasterVibeOrb } from "../orb/RasterVibeOrb.tsx";
import { ProceduralVibeOrb, useOrbHover, useReducedMotion } from "../orb/ProceduralVibeOrb.tsx";
import type { OrbVisualRecipe } from "../orb/recipe.ts";
import { orbVisualForVibe } from "../orb/vibeRecipe.ts";
import { useVibeObjects } from "../queries/index.ts";
import { MediaObjectThumbnail } from "../surfaces/MediaObjectThumbnail.tsx";
import { useNearViewport } from "../ui/useNearViewport.ts";
import { useSurfaceNavigation } from "./focus.ts";

const CARD_PREVIEW_LIMIT = 5;

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

/** Only the small navigation control subscribes to route changes, not the media-rich card. */
function DesktopVibeOpenButton({
  uuid,
  title,
  onOpen,
}: {
  uuid: string;
  title: string;
  onOpen: () => void;
}) {
  const navigation = useSurfaceNavigation();
  return (
    <button
      type="button"
      className="absolute inset-0 z-10 cursor-default rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      aria-label={`Open Vibe ${title}`}
      onClick={() => {
        onOpen();
        navigation.open({ kind: "vibe", uuid });
      }}
    />
  );
}

/** Compact desktop-only Vibe tile from Figma 5034:1108; intentionally not the shared Card. */
export function DesktopVibeCard({ vibe, now }: { vibe: Vibe; now: number }) {
  const uuid = uuidOf(vibe.uri);
  const { active: loadPreviews, ref } = useNearViewport<HTMLElement>();
  const objects = useVibeObjects(loadPreviews ? uuid : undefined);
  const details = objects.data ?? [];
  const previews = details.slice(0, CARD_PREVIEW_LIMIT);
  const source = details[0] ? objectSource(details[0]) : "Rhizome";
  const type = details[0] ? humanize(details[0].type) : undefined;
  const remaining = Math.max(0, vibe.objects.length - previews.length);
  const objectLabel = `${vibe.objects.length} ${vibe.objects.length === 1 ? "object" : "objects"}`;
  const updatedAge = relativeAge(vibe.updated_at, now);
  const visual = useMemo(() => {
    const orb = orbVisualForVibe(vibe);
    return {
      ...orb,
      backgroundColor: cardBackgroundColor(orb.recipe),
      backgroundSource: orb.loading ? "fallback" : "inferred",
    };
  }, [vibe]);
  const [orbHovered, setOrbHovered] = useState(false);
  const [orbFocused, setOrbFocused] = useState(false);
  const reducedMotion = useReducedMotion();
  const hoverActive = useOrbHover(orbHovered);
  // Activity preserves the card, but hover/focus must not survive a trip behind a window.
  useEffect(
    () => () => {
      setOrbHovered(false);
      setOrbFocused(false);
    },
    [],
  );

  return (
    <article
      ref={ref}
      data-desktop-vibe-card
      data-vibe-card-background={visual.backgroundSource}
      onPointerEnter={() => setOrbHovered(true)}
      onPointerLeave={() => setOrbHovered(false)}
      onFocusCapture={() => setOrbFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOrbFocused(false);
      }}
      style={{
        backgroundColor: `color-mix(in srgb, ${visual.backgroundColor} var(--vibe-card-opacity), transparent)`,
      }}
      className="group relative h-[102px] min-h-0 min-w-0 overflow-hidden rounded-sm shadow-[0_2px_10px_rgb(20_21_26/4%)] transition-[background-color,box-shadow] duration-150 ease-in [--vibe-card-opacity:92%] hover:shadow-[0_0_4px_0px_var(--rz-vibe-hover-shadow)] hover:[--vibe-card-opacity:100%] focus-within:shadow-[0_0_4px_0px_var(--rz-vibe-hover-shadow)] focus-within:[--vibe-card-opacity:100%] motion-reduce:transition-none"
    >
      <DesktopVibeOpenButton
        uuid={uuid}
        title={vibe.title}
        onOpen={() => {
          setOrbHovered(false);
          setOrbFocused(false);
        }}
      />

      <div className="flex h-full min-h-0 min-w-0 flex-col px-2 py-[9px]">
        <div className="flex min-h-0 min-w-0 gap-2">
          <div className="group/orb relative size-11 shrink-0">
            <RasterVibeOrb
              recipe={visual.recipe}
              loading={visual.loading}
              size={44}
              className="group-has-[[data-vibe-orb-renderer=webgl]]/orb:invisible"
            />
            {(hoverActive || orbFocused) && !visual.loading && !reducedMotion ? (
              <div className="pointer-events-none absolute inset-0">
                <ProceduralVibeOrb
                  recipe={visual.recipe}
                  motion="interaction"
                  active
                  fallback={false}
                  size={44}
                />
              </div>
            ) : null}
          </div>
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
            <MediaObjectThumbnail key={object.uri} object={object} />
          ))}
          {remaining > 0 ? (
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent font-sans font-bold leading-none text-on-accent tabular-nums">
              <span className="text-[8px]">+</span>
              <span className={remaining >= 100 ? "text-[9px]" : "text-[11px]"}>{remaining}</span>
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}
