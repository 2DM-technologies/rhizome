import { useState, type FormEvent } from "react";

import { cn } from "./cn.ts";
import { IconButton } from "./IconButton.tsx";
import { SendArrowIcon } from "./icons.tsx";

export interface ChatInputProps {
  /** The user's own orb. The prompt is addressed by the person sending it. */
  orbSrc: string;
  placeholder?: string;
  onSubmit?: (prompt: string) => void;
  disabled?: boolean;
  className?: string;
}

/** Figma 4861:43 — agent prompt input: personal orb, named placeholder, accent send. */
export function ChatInput({
  orbSrc,
  placeholder = "What's the move?",
  onSubmit,
  disabled = false,
  className,
}: ChatInputProps) {
  const [prompt, setPrompt] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || disabled) return;
    onSubmit?.(trimmed);
    setPrompt("");
  }

  return (
    <form
      onSubmit={submit}
      className={cn(
        "flex h-11 items-center gap-2 rounded-pill border border-hairline bg-canvas pl-2 pr-1.5 py-1.5",
        "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent",
        className,
      )}
    >
      <img src={orbSrc} alt="" aria-hidden className="size-6 shrink-0 object-cover" />
      <input
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        aria-label="Message the agent"
        className="min-w-0 flex-1 bg-transparent text-label font-sans text-primary outline-none placeholder:text-tertiary"
      />
      <IconButton
        type="submit"
        disabled={disabled || prompt.trim() === ""}
        aria-label="Send"
        tone="accent"
        size="sm"
      >
        <SendArrowIcon width={28} height={28} />
      </IconButton>
    </form>
  );
}
