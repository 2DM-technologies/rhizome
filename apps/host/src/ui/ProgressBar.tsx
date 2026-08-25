import { cn } from "./cn.ts";

export interface ProgressBarProps {
  /** 0–1. */
  value: number;
  label?: string;
  className?: string;
}

/** Figma 4859:290 — import/loading progress, accent gradient fill. */
export function ProgressBar({ value, label, className }: ProgressBarProps) {
  const clamped = Math.min(1, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={clamped}
      aria-label={label}
      className={cn(
        "flex h-3 items-start overflow-hidden rounded-pill bg-surface border border-black/6 w-80",
        className,
      )}
    >
      <div
        className="h-full rounded-pill bg-linear-to-r from-[#7d59ff] to-[#b845ff] transition-[width] duration-300"
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  );
}
