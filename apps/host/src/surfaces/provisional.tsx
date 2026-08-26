import type { ReactNode } from "react";

import { StatusChip, cn } from "../ui/index.ts";

/**
 * Scaffolding, not design.
 *
 * These surfaces exist to prove the data layer and the shell mechanism work end to end. They
 * are deliberately plain and deliberately marked, so nothing here gets mistaken for the
 * designed UI or quietly survives into it.
 */
export function Provisional({
  title,
  detail,
  children,
  className,
}: {
  title: string;
  detail?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-0 flex-col gap-5", className)}>
      <div className="flex items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-heading text-primary">{title}</span>
          {detail ? <span className="text-caption text-secondary">{detail}</span> : null}
        </div>
        <StatusChip status="neutral">provisional</StatusChip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

export function Pending({ label }: { label: string }) {
  return <span className="text-body text-tertiary">Loading {label}…</span>;
}

export function Failed({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return <span className="text-body text-error">{message}</span>;
}
