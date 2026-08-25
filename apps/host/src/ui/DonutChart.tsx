import type { ChartSlot } from "./CategoryDot.tsx";
import { cn } from "./cn.ts";

export interface DonutSlice {
  slot: ChartSlot;
  label: string;
  value: number;
}

export interface DonutChartProps {
  slices: readonly DonutSlice[];
  /** Center stack: caption above, value, caption below. */
  caption: string;
  value: string;
  footnote?: string;
  className?: string;
}

/**
 * Figma 4893:72 — spend-breakdown donut, 240×240. Measured off the design: outer radius 120,
 * ring 38.5 thick, first slice starting at twelve o'clock and running clockwise with no gap.
 * Angles are computed from the data rather than baked, per the component's Figma note.
 */
const BOX = 240;
const CENTER = BOX / 2;
const THICKNESS = 38.5;
const RADIUS = CENTER - THICKNESS / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const SLOT_VARIABLE: Record<ChartSlot, string> = {
  1: "var(--rz-chart-1)",
  2: "var(--rz-chart-2)",
  3: "var(--rz-chart-3)",
  4: "var(--rz-chart-4)",
  5: "var(--rz-chart-5)",
  6: "var(--rz-chart-6)",
  7: "var(--rz-chart-7)",
  8: "var(--rz-chart-8)",
};

export function DonutChart({ slices, caption, value, footnote, className }: DonutChartProps) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  let consumed = 0;

  return (
    <div className={cn("relative size-60 shrink-0", className)}>
      <svg viewBox={`0 0 ${BOX} ${BOX}`} className="size-full" role="img" aria-label={caption}>
        <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
          {slices.map((slice) => {
            const fraction = total > 0 ? slice.value / total : 0;
            const dash = fraction * CIRCUMFERENCE;
            const offset = -consumed * CIRCUMFERENCE;
            consumed += fraction;
            return (
              <circle
                key={slice.label}
                cx={CENTER}
                cy={CENTER}
                r={RADIUS}
                fill="none"
                stroke={SLOT_VARIABLE[slice.slot]}
                strokeWidth={THICKNESS}
                strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                strokeDashoffset={offset}
              />
            );
          })}
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 font-sans whitespace-nowrap">
        <span className="text-mono-label text-tertiary">{caption}</span>
        <span className="text-display text-primary">{value}</span>
        {footnote ? <span className="text-mono-label text-tertiary">{footnote}</span> : null}
      </div>
    </div>
  );
}
