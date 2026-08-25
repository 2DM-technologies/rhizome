import type { ReactNode } from "react";

import { cn } from "./cn.ts";

export type ChatSender = "you" | "rhizome";

export interface ChatMessageProps {
  sender: ChatSender;
  /** Display name for the sender label. */
  name?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Figma 4861:42 — agent conversation message. Content tier: it stays dark inside the
 * sidebar because it is page content, not a control, so it never inverts on its own.
 */
export function ChatMessage({ sender, name, children, className }: ChatMessageProps) {
  const isAgent = sender === "rhizome";
  return (
    <div className={cn("flex w-full flex-col items-start gap-1 font-sans", className)}>
      <span
        className={cn(
          "text-mono-label whitespace-nowrap",
          isAgent ? "text-accent" : "text-tertiary",
        )}
      >
        {name ?? (isAgent ? "Rhizome" : "You")}
      </span>
      <p className="w-full text-body text-primary">{children}</p>
    </div>
  );
}
