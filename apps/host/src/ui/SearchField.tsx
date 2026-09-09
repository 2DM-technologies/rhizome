import type { InputHTMLAttributes } from "react";

import { cn } from "./cn.ts";
import { SearchIcon } from "./icons.tsx";

export type SearchFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

/**
 * Universal dock search. Its 240 × 48px geometry stays fixed while the
 * translucent fill keeps the desktop blur visible without changing across tiers.
 */
export function SearchField({ className, placeholder = "Search", ...props }: SearchFieldProps) {
  return (
    <div
      className={cn(
        "flex h-12 w-60 items-center gap-2.5 rounded-pill bg-dock-search pl-[22px] pr-5 backdrop-blur-[10px]",
        className,
      )}
    >
      <SearchIcon className="shrink-0 text-white/85" />
      <input
        type="search"
        placeholder={placeholder}
        className={cn(
          "min-w-0 flex-1 bg-transparent text-body-lg font-sans text-on-accent outline-none",
          "placeholder:text-white/85 [&::-webkit-search-cancel-button]:appearance-none",
        )}
        {...props}
      />
    </div>
  );
}
