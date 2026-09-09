import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "./cn.ts";

export type IconButtonTone = "surface" | "ghost" | "accent";
export type IconButtonSize = "sm" | "md";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  "aria-label": string;
  children: ReactNode;
  tone?: IconButtonTone;
  size?: IconButtonSize;
}

const TONES: Record<IconButtonTone, string> = {
  surface: "bg-surface text-secondary hover:text-primary",
  ghost: "text-tertiary hover:text-primary",
  accent: "bg-accent text-on-accent",
};

const SIZES: Record<IconButtonSize, string> = {
  sm: "size-7",
  md: "size-8",
};

/** Accessible icon-only action with consistent sizing, focus, and disabled behavior. */
export function IconButton({
  children,
  className,
  size = "md",
  tone = "surface",
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "grid shrink-0 place-items-center rounded-pill transition-[color,opacity]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:pointer-events-none disabled:opacity-40",
        SIZES[size],
        TONES[tone],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
