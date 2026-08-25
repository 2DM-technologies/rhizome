import { cn } from "./cn.ts";

export interface FileChipProps {
  path: string;
  className?: string;
}

/**
 * Figma 4732:217 — inline file reference inside agent messages and tool calls.
 * Accent/secondary: a signal element, unaffected by tier.
 */
export function FileChip({ path, className }: FileChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[6px] bg-pill px-2 py-[3px]",
        "font-sans text-accent-secondary whitespace-nowrap",
        className,
      )}
    >
      <span className="text-[10px]" aria-hidden>
        ▤
      </span>
      <span className="text-caption">{path}</span>
    </span>
  );
}
