import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "./cn.ts";

export interface LoadingTextProps extends HTMLAttributes<HTMLSpanElement> {
  label: string;
}

export function LoadingText({ className, label, ...props }: LoadingTextProps) {
  return (
    <span className={cn("text-body text-tertiary", className)} {...props}>
      Loading {label}…
    </span>
  );
}

export interface InlineErrorProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

export function InlineError({ children, className, role = "alert", ...props }: InlineErrorProps) {
  return (
    <span role={role} className={cn("text-body text-error", className)} {...props}>
      {children}
    </span>
  );
}
