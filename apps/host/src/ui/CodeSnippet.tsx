import { cn } from "./cn.ts";

export type DiffKind = "add" | "remove" | "context";

export interface DiffLine {
  kind: DiffKind;
  text: string;
}

export interface CodeSnippetProps {
  lines: readonly DiffLine[];
  className?: string;
}

const MARKERS: Record<DiffKind, string> = { add: "+", remove: "−", context: "​" };
const TONES: Record<DiffKind, string> = {
  add: "text-success",
  remove: "text-error",
  context: "text-primary",
};

/**
 * Figma 4732:240 — code block for agent messages and tool output. Content tier (bg/pill):
 * a distinct surface, not a full inversion.
 */
export function CodeSnippet({ lines, className }: CodeSnippetProps) {
  return (
    <pre
      className={cn(
        "flex w-full flex-col gap-[3px] overflow-x-auto rounded-[10px] bg-pill px-3.5 py-3",
        "font-sans text-caption",
        className,
      )}
    >
      {lines.map((line, index) => (
        // Diff lines are positional: the same text can legitimately appear twice.
        <code key={index} className={cn("flex items-start gap-1.5", TONES[line.kind])}>
          <span className="shrink-0 font-medium" aria-hidden>
            {MARKERS[line.kind]}
          </span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap">{line.text}</span>
        </code>
      ))}
    </pre>
  );
}
