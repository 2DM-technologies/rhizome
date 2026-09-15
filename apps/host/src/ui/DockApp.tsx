import { useState, type CSSProperties, type MouseEventHandler, type ReactNode } from "react";

import type { OrbVisualRecipe } from "../orb/recipe.ts";
import { ProceduralVibeOrb, useOrbHover, useReducedMotion } from "../orb/ProceduralVibeOrb.tsx";
import { RasterVibeOrb } from "../orb/RasterVibeOrb.tsx";
import { cn } from "./cn.ts";

export interface DockAppProps {
  name: string;
  /** App mark (active) or orb artwork (running). */
  src?: string;
  /** Unframed artwork, such as a media object's element preview. */
  artwork?: ReactNode;
  /** Shared vector icon in place of the artwork. */
  icon?: ReactNode;
  recipe?: OrbVisualRecipe;
  orbLoading?: boolean;
  state?: "active" | "running";
  /** Current surface indicator for a shortcut that stays in its pinned position. */
  current?: boolean;
  onOpen?: MouseEventHandler<HTMLButtonElement>;
  style?: CSSProperties;
  className?: string;
}

/**
 * Figma 4902:188 — app presence in the dock.
 * active  — content-tier 64 card with an accent glow; overhangs the 64 tray.
 * running — a compact orb that lives inside the tray; only the active window shows its label.
 */
export function DockApp({
  name,
  src,
  artwork,
  icon,
  recipe,
  orbLoading = false,
  state = "running",
  current = false,
  onOpen,
  style,
  className,
}: DockAppProps) {
  const active = state === "active";
  const [orbHovered, setOrbHovered] = useState(false);
  const [orbFocused, setOrbFocused] = useState(false);
  const reducedMotion = useReducedMotion();
  const hoverActive = useOrbHover(orbHovered);
  const animateOrb = !orbLoading && !reducedMotion && (hoverActive || orbFocused);
  const mark = artwork ? (
    <span aria-hidden className="block size-11 shrink-0">
      {artwork}
    </span>
  ) : icon ? (
    <span className="grid size-11 shrink-0 place-items-center rounded-[35%] bg-surface/25 shadow-[inset_0_0_0_1px_var(--rz-border-neutral)] [corner-shape:squircle]">
      {icon}
    </span>
  ) : recipe ? (
    <span className="group/orb relative block size-11 shrink-0">
      <RasterVibeOrb
        recipe={recipe}
        loading={orbLoading}
        size={44}
        className="group-has-[[data-vibe-orb-renderer=webgl]]/orb:invisible"
      />
      {animateOrb ? (
        <span className="pointer-events-none absolute inset-0">
          <ProceduralVibeOrb
            recipe={recipe}
            motion="interaction"
            active
            fallback={false}
            size={44}
          />
        </span>
      ) : null}
    </span>
  ) : src ? (
    <img src={src} alt="" aria-hidden className="size-11 shrink-0 object-cover" />
  ) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") setOrbHovered(true);
      }}
      onPointerLeave={() => setOrbHovered(false)}
      onPointerDown={() => setOrbFocused(false)}
      onFocus={(event) => setOrbFocused(event.currentTarget.matches(":focus-visible"))}
      onBlur={() => setOrbFocused(false)}
      style={style}
      aria-label={name}
      aria-current={active || current ? "true" : undefined}
      className={cn(
        "group shrink-0 outline-none transition-transform",
        active &&
          !icon &&
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        active
          ? "grid size-17 place-items-center hover:-translate-y-0.5 focus-visible:-translate-y-0.5"
          : "relative flex h-16 w-11 items-center justify-center hover:-translate-y-[5px] focus-visible:-translate-y-[5px]",
        current &&
          !active &&
          "after:absolute after:bottom-[5px] after:size-1 after:rounded-full after:bg-[#8f8f8f] after:transition-opacity after:duration-100 after:ease-out hover:after:opacity-0 focus-visible:after:opacity-0",
        className,
      )}
    >
      {active ? (
        <span
          data-dock-app-surface
          className="flex size-16 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-sm bg-dock-card shadow-[0px_0px_6px_0px_var(--rz-dock-glow)] backdrop-blur-[10px]"
        >
          {mark}
          <span
            data-dock-app-label
            aria-hidden
            className="max-w-14 truncate text-[9px] leading-[10px] font-semibold text-secondary"
          >
            {name}
          </span>
        </span>
      ) : (
        <>
          {mark}
          <span
            data-dock-app-label
            aria-hidden
            className="absolute bottom-0 max-w-11 truncate text-[9px] leading-[10px] font-semibold text-secondary opacity-0 transition-opacity duration-100 ease-out group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            {name}
          </span>
        </>
      )}
    </button>
  );
}
