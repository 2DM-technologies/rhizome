import { useEffect, useId, useRef, useState } from "react";

import { useSession } from "../session/session.ts";
import { useDockPinsStore, usePinnedVibeUuids } from "../shell/dockPins.ts";
import { IconButton } from "../ui/IconButton.tsx";
import { MoreIcon } from "../ui/icons.tsx";

export function VibeActionsMenu({ uuid, onDelete }: { uuid: string; onDelete?: () => void }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const focusLastOnOpen = useRef(false);
  const userId = useSession().data?.user.id;
  const pinned = usePinnedVibeUuids().includes(uuid);
  const setPinned = useDockPinsStore((state) => state.setPinned);

  function dismiss() {
    setOpen(false);
    root.current?.querySelector<HTMLButtonElement>("[aria-haspopup]")?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const items = root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    items?.[focusLastOnOpen.current ? items.length - 1 : 0]?.focus();
    focusLastOnOpen.current = false;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  return (
    <div
      ref={root}
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          dismiss();
        } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          if (!open) {
            focusLastOnOpen.current = event.key === "ArrowUp" || event.key === "End";
            setOpen(true);
            return;
          }
          const items = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
          );
          const current = items.findIndex((item) => item === document.activeElement);
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
          items[next]?.focus();
        }
      }}
    >
      <IconButton
        aria-label="Vibe options"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        tone="ghost"
        className="cursor-pointer"
        onClick={() => setOpen((value) => !value)}
      >
        <MoreIcon />
      </IconButton>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Vibe options"
          className="absolute right-0 top-full z-20 mt-2 w-44 rounded-md border border-hairline bg-surface p-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            className="w-full cursor-pointer rounded-sm px-3 py-2 text-left text-label text-primary hover:bg-accent/12 focus:bg-accent/12 focus:outline-none"
            onClick={() => {
              if (userId) setPinned(userId, uuid, !pinned);
              dismiss();
            }}
          >
            {pinned ? "Unpin from dock" : "Pin to dock"}
          </button>
          {onDelete ? (
            <button
              type="button"
              role="menuitem"
              className="w-full cursor-pointer rounded-sm px-3 py-2 text-left text-label text-error hover:bg-error/10 focus:bg-error/10 focus:outline-none"
              onClick={() => {
                dismiss();
                onDelete();
              }}
            >
              Delete Vibe
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
