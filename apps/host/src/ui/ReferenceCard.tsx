import type { HTMLAttributes, ReactNode } from "react";

import { Badge } from "./Badge.tsx";
import { cn } from "./cn.ts";

export interface ReferenceCardProps extends Omit<HTMLAttributes<HTMLLIElement>, "children"> {
  borderTone?: "hairline" | "accent-secondary";
  children?: ReactNode;
  label: string;
  reference: string;
  compact?: boolean;
}

export function ReferenceCard({
  borderTone = "hairline",
  children,
  className,
  compact = false,
  label,
  reference,
  ...props
}: ReferenceCardProps) {
  return (
    <li
      className={cn(
        "flex rounded-sm border",
        borderTone === "accent-secondary" ? "border-accent-secondary" : "border-hairline",
        compact ? "min-w-0 items-center gap-2 p-3" : "flex-col gap-3 p-4",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Badge>{label}</Badge>
        <code className="min-w-0 flex-1 truncate text-caption text-secondary">{reference}</code>
      </div>
      {children}
    </li>
  );
}
