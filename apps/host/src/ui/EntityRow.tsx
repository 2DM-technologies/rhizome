import type { ElementType, HTMLAttributes, ReactNode } from "react";

import { cn } from "./cn.ts";

export interface EntityRowProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  as?: "div" | "li";
  title: ReactNode;
  titleClassName?: string;
  subtitle?: ReactNode;
  subtitleClassName?: string;
  leading?: ReactNode;
  meta?: ReactNode;
  metaClassName?: string;
  trailing?: ReactNode;
  onSelect?: () => void;
  selectLabel?: string;
  variant?: "flat" | "surface";
  align?: "center" | "baseline";
}

/** Neutral row foundation for Vibes, objects, imports, tracks, and other entities. */
export function EntityRow({
  align = "center",
  as = "div",
  className,
  leading,
  meta,
  metaClassName,
  onSelect,
  selectLabel,
  subtitle,
  subtitleClassName,
  title,
  titleClassName,
  trailing,
  variant = "flat",
  ...props
}: EntityRowProps) {
  const Component: ElementType = as;
  const content = (
    <>
      {leading}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
        <span className={cn("truncate", titleClassName ?? "text-label text-primary")}>{title}</span>
        {subtitle ? (
          <span className={cn("truncate", subtitleClassName ?? "text-caption text-secondary")}>
            {subtitle}
          </span>
        ) : null}
      </span>
      {meta ? (
        <span className={cn("shrink-0", metaClassName ?? "text-caption text-tertiary")}>
          {meta}
        </span>
      ) : null}
    </>
  );
  const contentClassName = cn(
    "flex min-w-0 flex-1 gap-3 text-left",
    align === "baseline" ? "items-baseline" : "items-center",
    variant === "flat" && "py-3",
  );

  return (
    <Component
      className={cn(
        "flex min-w-0 items-center gap-3 font-sans",
        variant === "flat" ? "border-b border-hairline" : "h-14 rounded-sm bg-surface px-2.5 py-2",
        className,
      )}
      {...props}
    >
      {onSelect ? (
        <button
          type="button"
          onClick={onSelect}
          aria-label={selectLabel}
          className={contentClassName}
        >
          {content}
        </button>
      ) : (
        <div className={contentClassName}>{content}</div>
      )}
      {trailing}
    </Component>
  );
}
