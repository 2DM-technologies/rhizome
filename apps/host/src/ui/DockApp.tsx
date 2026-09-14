import type { CSSProperties, MouseEventHandler } from "react";

import type { OrbVisualRecipe } from "../orb/recipe.ts";
import { ProceduralVibeOrb } from "../orb/ProceduralVibeOrb.tsx";
import { cn } from "./cn.ts";

export interface DockAppProps {
  name: string;
  /** App mark (active) or orb artwork (running). */
  src: string;
  recipe?: OrbVisualRecipe;
  orbLoading?: boolean;
  state?: "active" | "running";
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
  recipe,
  orbLoading = false,
  state = "running",
  onOpen,
  style,
  className,
}: DockAppProps) {
  const active = state === "active";
  const mark = recipe ? (
    <ProceduralVibeOrb recipe={recipe} motion="continuous" loading={orbLoading} size={40} />
  ) : (
    <img src={src} alt="" aria-hidden className="size-10 shrink-0 object-cover" />
  );
  return (
    <button
      type="button"
      onClick={onOpen}
      style={style}
      aria-label={name}
      aria-current={active ? "true" : undefined}
      className={cn(
        "group shrink-0 transition-transform",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        active
          ? "grid size-17 place-items-center hover:-translate-y-0.5 focus-visible:-translate-y-0.5"
          : "relative flex h-16 w-11 items-center justify-center hover:-translate-y-[5px] focus-visible:-translate-y-[5px]",
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
