import type { ButtonHTMLAttributes } from "react";

import { cn } from "./cn.ts";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent",
  secondary: "bg-surface border border-hairline text-primary",
  ghost: "text-accent",
  danger: "bg-error text-white",
};

/** Figma 4859:265 — pill radius, Label type. Primary fills, Secondary is surface + hairline. */
export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "flex items-center px-5 py-3 rounded-pill text-label font-sans whitespace-nowrap",
        "transition-opacity hover:opacity-85 disabled:opacity-40 disabled:pointer-events-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
