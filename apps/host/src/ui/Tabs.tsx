import { cn } from "./cn.ts";

export interface TabsProps<Value extends string> {
  options: readonly { value: Value; label: string }[];
  value: Value;
  onChange: (value: Value) => void;
  label: string;
  className?: string;
}

/** Figma 4892:76 — segmented switch. Active is a raised canvas pill on a surface strip. */
export function Tabs<Value extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: TabsProps<Value>) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("inline-flex items-center gap-1 rounded-pill bg-surface p-1", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex items-center rounded-pill px-4 py-2 text-label font-sans whitespace-nowrap",
              active
                ? "bg-canvas border border-hairline text-primary drop-shadow-[0px_1px_1px_rgba(20,20,26,0.06)]"
                : "text-secondary",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
