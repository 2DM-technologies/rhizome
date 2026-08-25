import type { ButtonHTMLAttributes } from "react";

import { cn } from "./cn.ts";
import { ChevronDownIcon } from "./icons.tsx";

export interface SelectProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

/** Figma 4892:77 — closed dropdown trigger. Pill, hairline border. */
export function Select({ value, className, ...props }: SelectProps) {
  return (
    <button
      type="button"
      className={cn(
        "flex items-center gap-2 rounded-pill border border-hairline bg-canvas pl-[14px] pr-3 py-2",
        "text-label font-sans text-primary whitespace-nowrap",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        className,
      )}
      {...props}
    >
      {value}
      <ChevronDownIcon className="text-secondary" />
    </button>
  );
}
