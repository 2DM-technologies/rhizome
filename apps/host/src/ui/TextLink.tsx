import type { AnchorHTMLAttributes, ReactNode } from "react";

import { cn } from "./cn.ts";

export interface TextLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  children: ReactNode;
  tone?: "accent" | "secondary";
  size?: "caption" | "label";
}

export function TextLink({
  children,
  className,
  size = "caption",
  tone = "accent",
  ...props
}: TextLinkProps) {
  return (
    <a
      className={cn(
        "w-fit underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent",
        tone === "accent" ? "text-accent" : "text-secondary",
        size === "caption" ? "text-caption" : "text-label",
        className,
      )}
      {...props}
    >
      {children}
    </a>
  );
}
