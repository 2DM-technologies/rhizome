import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "./cn.ts";

export interface MetadataItem {
  term: ReactNode;
  value: ReactNode;
  mono?: boolean;
}

export interface MetadataListProps extends HTMLAttributes<HTMLDListElement> {
  items: readonly MetadataItem[];
}

export function MetadataList({ className, items, ...props }: MetadataListProps) {
  return (
    <dl
      className={cn("grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-caption", className)}
      {...props}
    >
      {items.map((item, index) => (
        <div key={index} className="contents">
          <dt className="text-tertiary">{item.term}</dt>
          <dd className={cn("text-secondary", item.mono && "break-all font-mono")}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
