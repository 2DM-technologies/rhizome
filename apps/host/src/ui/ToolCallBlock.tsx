import { StatusChip, type ChipStatus } from "./StatusChip.tsx";
import { cn } from "./cn.ts";

export type LogTone = "success" | "error" | "muted";

export interface ToolCallLine {
  tone?: LogTone;
  text: string;
}

export interface ToolCallBlockProps {
  /** The command as run, e.g. "⚙ Run: bun test ingest". */
  title: string;
  status: ChipStatus;
  statusLabel: string;
  lines: readonly ToolCallLine[];
  /**
   * `stream` is the wide card in the agent sidebar (Figma 4732:251).
   * `compact` is the 280px mono Run Card from the design system (Figma 4861:48).
   */
  variant?: "stream" | "compact";
  className?: string;
}

const TONES: Record<LogTone, string> = {
  success: "text-success",
  error: "text-error",
  muted: "text-on-pill",
};

/**
 * Agent tool-execution result: command header, status, and the run's output.
 *
 * The card is `bg-surface`, so it takes the polarity of whatever tier it lands in.
 * Wrap it in `data-tier="control"` for the raised-control reading on Figma 4732:251;
 * otherwise it follows the surrounding stream as the system theme changes.
 */
export function ToolCallBlock({
  title,
  status,
  statusLabel,
  lines,
  variant = "stream",
  className,
}: ToolCallBlockProps) {
  const compact = variant === "compact";
  return (
    <div
      className={cn(
        "flex flex-col bg-surface font-sans",
        compact ? "w-70 gap-2 rounded-sm px-3 py-2.5" : "w-full gap-2.5 rounded-md px-3.5 py-3",
        className,
      )}
    >
      <div className="flex w-full items-center justify-between gap-2 overflow-hidden">
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-primary",
            compact ? "font-mono text-caption" : "text-label",
          )}
        >
          {title}
        </span>
        <StatusChip status={status}>{statusLabel}</StatusChip>
      </div>
      <div
        className={cn(
          "flex w-full flex-col gap-0.5 overflow-x-auto rounded-sm bg-pill px-2.5 py-2 whitespace-nowrap",
          compact ? "font-mono text-[10px]" : "text-mono-label",
        )}
      >
        {lines.map((line, index) => (
          // Log lines are positional and may repeat verbatim.
          <span key={index} className={TONES[line.tone ?? "muted"]}>
            {line.text}
          </span>
        ))}
      </div>
    </div>
  );
}
