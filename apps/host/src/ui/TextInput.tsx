import { forwardRef, type InputHTMLAttributes } from "react";

import { cn } from "./cn.ts";

export type TextInputTone = "surface" | "canvas";
export type TextInputTypography = "body" | "caption" | "mono";

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  tone?: TextInputTone;
  typography?: TextInputTypography;
}

const TONES: Record<TextInputTone, string> = {
  surface: "bg-surface",
  canvas: "bg-canvas",
};

const TYPOGRAPHY: Record<TextInputTypography, string> = {
  body: "text-body",
  caption: "text-caption",
  mono: "font-mono text-caption",
};

/** Native text-like input with the shared Rhizome field geometry and focus treatment. */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { className, tone = "surface", typography = "body", type = "text", ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        "w-full rounded-pill border border-hairline px-5 py-3 text-primary outline-none",
        "placeholder:text-tertiary focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent",
        "disabled:pointer-events-none disabled:opacity-40",
        TONES[tone],
        TYPOGRAPHY[typography],
        className,
      )}
      {...props}
    />
  );
});
