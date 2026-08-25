import { cn } from "./cn.ts";

/** Chart slot, 1-indexed to match the Figma `chart/N` variables. */
export type ChartSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface CategoryDotProps {
  slot: ChartSlot;
  className?: string;
}

const SLOTS: Record<ChartSlot, string> = {
  1: "bg-chart-1",
  2: "bg-chart-2",
  3: "bg-chart-3",
  4: "bg-chart-4",
  5: "bg-chart-5",
  6: "bg-chart-6",
  7: "bg-chart-7",
  8: "bg-chart-8",
};

/** Figma 4892:66 — categorical swatch for chart legends and tables. */
export function CategoryDot({ slot, className }: CategoryDotProps) {
  return (
    <span className={cn("size-2.5 shrink-0 rounded-[3px]", SLOTS[slot], className)} aria-hidden />
  );
}
