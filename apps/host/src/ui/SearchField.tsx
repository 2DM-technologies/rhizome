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
      <SearchIcon width={16} height={16} className="shrink-0 text-dock-search-placeholder" />
      <input
        type="search"
        placeholder={placeholder}
        className={cn(
          "min-w-0 flex-1 bg-transparent text-body font-sans text-dock-search-text outline-none",
          "placeholder:text-dock-search-placeholder [&::-webkit-search-cancel-button]:appearance-none",
        )}
        {...props}
      />
    </div>
  );
}
