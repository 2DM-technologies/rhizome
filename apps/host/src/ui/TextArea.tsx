import { forwardRef, type TextareaHTMLAttributes } from "react";

import { cn } from "./cn.ts";

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  bordered?: boolean;
  tone?: "surface" | "canvas";
  typography?: "body" | "caption" | "mono";
}

/** Multiline companion to TextInput. */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { bordered = true, className, tone = "surface", typography = "body", ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-sm p-3 text-primary outline-none",
        bordered && "border border-hairline",
        "placeholder:text-tertiary focus-visible:outline-2 focus-visible:outline-accent",
        "disabled:pointer-events-none disabled:opacity-40",
        tone === "canvas" ? "bg-canvas" : "bg-surface",
        typography === "mono"
          ? "font-mono text-caption"
          : typography === "caption"
            ? "text-caption"
            : "text-body",
        className,
      )}
      {...props}
    />
  );
});
