import { CategoryDot, type ChartSlot } from "./CategoryDot.tsx";
import { cn } from "./cn.ts";

export interface LegendRowProps {
  slot: ChartSlot;
  label: string;
  amount: string;
  share: string;
  className?: string;
}

/** Figma 4892:67 — donut legend line: dot + label (fills) + amount + share. */
export function LegendRow({ slot, label, amount, share, className }: LegendRowProps) {
  return (
    <div className={cn("flex h-6 items-center gap-2.5 py-[3px] font-sans", className)}>
      <CategoryDot slot={slot} />
      <span className="min-w-0 flex-1 truncate text-label text-primary">{label}</span>
      <span className="shrink-0 text-label text-primary whitespace-nowrap">{amount}</span>
      <span className="w-11 shrink-0 text-right text-caption text-tertiary">{share}</span>
    </div>
  );
}
