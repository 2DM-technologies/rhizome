import { CategoryDot, type ChartSlot } from "./CategoryDot.tsx";
import { cn } from "./cn.ts";

export interface CategoryTableEntry {
  slot: ChartSlot;
  label: string;
  amount: string;
  share: string;
}

export interface CategoryTableProps {
  columns?: { category: string; total: string; share: string };
  entries: readonly CategoryTableEntry[];
  total?: { label: string; amount: string; share: string };
  className?: string;
}

const RULE = "border-neutral-border";
const CELL = "flex h-9 items-center gap-3 px-1 py-2.5 font-sans";

/**
 * Figma 4893:71 — Header (mono-caps), Row (dot + label / total / share), Total (top rule).
 * Rendered as a real table so the header cells are announced with their columns.
 */
export function CategoryTable({
  columns = { category: "CATEGORY", total: "TOTAL", share: "SHARE" },
  entries,
  total,
  className,
}: CategoryTableProps) {
  return (
    <div className={cn("flex flex-col", className)}>
      <div className={cn(CELL, "border-b", RULE, "text-mono-label text-tertiary")} role="row">
        <span className="min-w-0 flex-1">{columns.category}</span>
        <span className="w-[90px] shrink-0 text-right">{columns.total}</span>
        <span className="w-[50px] shrink-0 text-right">{columns.share}</span>
      </div>
      {entries.map((entry) => (
        <div key={entry.label} className={cn(CELL, "border-b", RULE)} role="row">
          <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            <CategoryDot slot={entry.slot} />
            <span className="truncate text-label text-primary">{entry.label}</span>
          </span>
          <span className="w-[90px] shrink-0 text-right text-label text-primary">
            {entry.amount}
          </span>
          <span className="w-[50px] shrink-0 text-right text-label text-secondary">
            {entry.share}
          </span>
        </div>
      ))}
      {total ? (
        <div className={cn(CELL, "border-t", RULE, "text-label text-primary")} role="row">
          <span className="min-w-0 flex-1">{total.label}</span>
          <span className="w-[90px] shrink-0 text-right">{total.amount}</span>
          <span className="w-[50px] shrink-0 text-right">{total.share}</span>
        </div>
      ) : null}
    </div>
  );
}
