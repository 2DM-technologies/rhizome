import type { ReactNode } from "react";

import { isStoreError } from "../api/storeError.ts";
import { Badge, InlineError, LoadingText, SurfaceHeader, cn } from "../ui/index.ts";

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
    <div className={cn("flex min-h-full flex-col gap-5", className)}>
      <SurfaceHeader title={title} detail={detail} actions={<Badge>provisional</Badge>} />
      <div className="flex-1">{children}</div>
    </div>
  );
}

/** Store-backed host surface frame. Unlike a future-milestone placeholder, it carries no badge. */
export function StoreSurface({
  title,
  detail,
  children,
  actions,
  className,
}: {
  title: string;
  detail?: string;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-full flex-col gap-5", className)}>
      <SurfaceHeader title={title} detail={detail} actions={actions} />
      <div className="flex-1">{children}</div>
    </div>
  );
}

export function Pending({ label }: { label: string }) {
  return <LoadingText label={label} />;
}

export function Failed({ error }: { error: unknown }) {
  const message = isStoreError(error)
    ? error.detail
    : error instanceof Error
      ? error.message
      : String(error);
  return <InlineError>{message}</InlineError>;
}
