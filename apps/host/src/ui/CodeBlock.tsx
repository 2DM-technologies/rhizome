import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "./cn.ts";

export interface CodeBlockProps extends HTMLAttributes<HTMLPreElement> {
  children: ReactNode;
  tone?: "canvas" | "pill";
  typography?: "mono" | "sans";
}

export function CodeBlock({
  children,
  className,
  tone = "canvas",
  typography = "mono",
  ...props
}: CodeBlockProps) {
  return (
    <pre
      className={cn(
        "overflow-auto whitespace-pre-wrap break-words rounded-sm p-3 text-caption text-secondary",
        typography === "mono" ? "font-mono" : "font-sans",
        tone === "canvas" ? "bg-canvas" : "bg-pill",
        className,
      )}
      {...props}
    >
      {children}
    </pre>
  );
}
