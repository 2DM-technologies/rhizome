import { forwardRef, type HTMLAttributes, type InputHTMLAttributes } from "react";

import { cn } from "./cn.ts";
import { SearchIcon } from "./icons.tsx";

type DataAttributes = {
  [key: `data-${string}`]: string | number | boolean | undefined;
};

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Standalone fields paint the dock search surface; embedded fields inherit a parent surface. */
  surface?: "standalone" | "embedded";
  /** Styles the fixed search row without conflating it with the native input. */
  containerClassName?: string;
  containerProps?: Omit<HTMLAttributes<HTMLDivElement>, "className"> & DataAttributes;
}

/**
 * Universal dock search. Its 240 × 48px geometry stays fixed while the
 * translucent fill keeps the desktop blur visible without changing across tiers.
 */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  {
    className,
    containerClassName,
    containerProps,
    placeholder = "Search",
    surface = "standalone",
    ...props
  },
  ref,
) {
  return (
    <div
      {...containerProps}
      data-search-field
      data-surface={surface}
      className={cn(
        "flex h-12 w-60 items-center gap-2.5 rounded-pill pl-[22px] pr-5",
        surface === "standalone" && "bg-dock-search backdrop-blur-[10px]",
        containerClassName,
      )}
    >
      <SearchIcon width={16} height={16} className="shrink-0 text-dock-search-placeholder" />
      <input
        ref={ref}
        type="search"
        placeholder={placeholder}
        className={cn(
          "min-w-0 flex-1 bg-transparent text-body font-sans text-dock-search-text outline-none",
          "placeholder:text-dock-search-placeholder [&::-webkit-search-cancel-button]:appearance-none",
          className,
        )}
        {...props}
      />
    </div>
  );
});
