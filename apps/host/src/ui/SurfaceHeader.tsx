import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "./cn.ts";

export interface SurfaceHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  detail?: ReactNode;
  actions?: ReactNode;
}

export function SurfaceHeader({ actions, className, detail, title, ...props }: SurfaceHeaderProps) {
  return (
    <header className={cn("flex items-start gap-4", className)} {...props}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h1 className="text-heading text-primary">{title}</h1>
        {detail ? <span className="text-caption text-secondary">{detail}</span> : null}
      </div>
      {actions}
    </header>
  );
}
