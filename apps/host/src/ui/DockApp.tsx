import { cn } from "./cn.ts";

export interface DockAppProps {
  name: string;
  /** App mark (active) or orb artwork (running). */
  src: string;
  state?: "active" | "running";
  onOpen?: () => void;
  className?: string;
}

/**
 * Figma 4902:188 — app presence in the dock.
 * active  — white 64 card with an accent glow and a 52px mark; overhangs the 64 tray.
 * running — a 44px orb that lives inside the tray.
 */
export function DockApp({ name, src, state = "running", onOpen, className }: DockAppProps) {
  const active = state === "active";
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={name}
      aria-current={active ? "true" : undefined}
      className={cn(
        "shrink-0 transition-transform hover:-translate-y-0.5",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        active ? "grid size-17 place-items-center" : "size-11",
        className,
      )}
    >
      {active ? (
        <span className="grid size-16 place-items-center overflow-hidden rounded-sm bg-dock-card shadow-[0px_0px_6px_0px_var(--rz-dock-glow)]">
          <img src={src} alt="" aria-hidden className="size-13 object-cover" />
        </span>
      ) : (
        <img src={src} alt="" aria-hidden className="size-11 object-cover" />
      )}
    </button>
  );
}
