import { cn } from "./cn.ts";
import { CheckIcon } from "./icons.tsx";

export interface MenuItemProps {
  label: string;
  selected?: boolean;
  onSelect?: () => void;
  className?: string;
}

/** Figma 4892:86 — dropdown row. Selected is an accent check over a 12% accent wash. */
export function MenuItem({ label, selected = false, onSelect, className }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex h-8 w-[220px] items-center gap-2 rounded-[6px] px-2.5 py-[7px]",
        "text-label font-sans text-primary text-left",
        selected && "bg-accent/12",
        className,
      )}
    >
      <span className="flex w-2.5 shrink-0 justify-center text-accent">
        {selected ? <CheckIcon /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
