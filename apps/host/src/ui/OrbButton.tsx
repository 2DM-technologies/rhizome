import type { ButtonHTMLAttributes } from "react";

import { cn } from "./cn.ts";
import { VibeOrb, type VibeOrbSize } from "./VibeOrb.tsx";

export interface OrbButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  label: string;
  src: string;
  orbSize?: VibeOrbSize;
}

export function OrbButton({
  className,
  label,
  orbSize = "lg",
  src,
  type = "button",
  ...props
}: OrbButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cn(
        "rounded-full transition-transform hover:-translate-y-0.5",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        className,
      )}
      {...props}
    >
      <VibeOrb src={src} size={orbSize} alt="" />
    </button>
  );
}
