import { forwardRef, type SelectHTMLAttributes } from "react";

import { cn } from "./cn.ts";
import { ChevronDownIcon } from "./icons.tsx";

export interface SelectInputProps extends SelectHTMLAttributes<HTMLSelectElement> {
  containerClassName?: string;
}

/** Native select with shared field styling and a consistently positioned caret. */
export const SelectInput = forwardRef<HTMLSelectElement, SelectInputProps>(function SelectInput(
  { children, className, containerClassName, ...props },
  ref,
) {
  return (
    <span className={cn("relative block", containerClassName)}>
      <select
        ref={ref}
        className={cn(
          "w-full appearance-none rounded-md border border-hairline bg-canvas py-3 pl-5 pr-12",
          "text-caption text-primary outline-none",
          "focus-visible:outline-2 focus-visible:outline-accent",
          "disabled:pointer-events-none disabled:opacity-40",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon
        data-select-input-caret
        className="pointer-events-none absolute top-1/2 right-5 -translate-y-1/2 text-primary"
      />
    </span>
  );
});
