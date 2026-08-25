import type { InputHTMLAttributes } from "react";

import { cn } from "./cn.ts";
import { SearchIcon } from "./icons.tsx";

export type SearchFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

/**
 * Figma 4859:276 — universal search. The dark pill is deliberate: this control keeps
 * `bg/pill` in both tiers rather than inverting, so search reads the same everywhere.
 */
export function SearchField({ className, placeholder = "Search", ...props }: SearchFieldProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 h-12 pl-[22px] pr-5 rounded-pill bg-pill w-60",
        "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent",
        className,
      )}
    >
      <SearchIcon className="shrink-0 text-on-pill" />
      <input
        type="search"
        placeholder={placeholder}
        className={cn(
          "min-w-0 flex-1 bg-transparent text-body-lg font-sans text-on-accent outline-none",
          "placeholder:text-on-pill [&::-webkit-search-cancel-button]:appearance-none",
        )}
        {...props}
      />
    </div>
  );
}
