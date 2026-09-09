import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "./cn.ts";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  tone?: "neutral" | "accent";
}

/** Categorical label without StatusChip's state dot or success/error semantics. */
export function Badge({ children, className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-pill px-2.5 py-1 font-sans text-mono-label",
        tone === "accent" ? "bg-accent text-on-accent" : "bg-neutral-tint text-secondary",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
