import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "./cn.ts";

export interface CalloutProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  tone?: "neutral" | "success" | "error";
}

export function Callout({ children, className, tone = "neutral", ...props }: CalloutProps) {
  return (
    <div
      className={cn(
        "rounded-card border border-hairline p-4",
        tone === "success" ? "bg-success-tint" : tone === "error" ? "bg-error-tint" : "bg-canvas",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
