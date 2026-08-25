import { cn } from "./cn.ts";

export interface StatCardProps {
  label: string;
  value: string;
  className?: string;
}

/** Figma 4860:43 — key/value stat, e.g. Closest Genre on vibe results. */
export function StatCard({ label, value, className }: StatCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-md border border-hairline bg-surface",
        "px-[18px] pt-4 pb-[18px] w-[186px] whitespace-nowrap font-sans",
        className,
      )}
    >
      <span className="text-label text-secondary">{label}</span>
      <span className="text-heading text-primary">{value}</span>
    </div>
  );
}
