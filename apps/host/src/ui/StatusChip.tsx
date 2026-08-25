import { cn } from "./cn.ts";

export type ChipStatus = "success" | "error" | "neutral";

export interface StatusChipProps {
  status?: ChipStatus;
  children: string;
  className?: string;
}

const STATUSES: Record<ChipStatus, string> = {
  success: "bg-success-tint text-success",
  error: "bg-error-tint text-error",
  neutral: "bg-neutral-tint text-secondary",
};

/**
 * Figma 4859:275 — dot + Mono Label. Surfaces ingestion/verify state: dry-run VERIFY.md
 * results and push-pipeline status.
 */
export function StatusChip({ status = "success", children, className }: StatusChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill text-mono-label font-sans whitespace-nowrap",
        STATUSES[status],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}
