import { useEffect, useId, useRef } from "react";

import { Button } from "../ui/index.ts";
import { Failed } from "./provisional.tsx";

export function DeleteVibeDialog({
  title,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  useEffect(() => {
    // Disabling the focused confirmation button must not return keyboard input to the shell.
    if (pending) dialogRef.current?.focus();
  }, [pending]);

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={pending}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[28rem] overflow-y-auto rounded-lg border border-hairline bg-surface p-6 text-primary shadow-2xl backdrop:bg-black/50"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (!pending) onCancel();
        } else if (event.key === "Tab") {
          const buttons =
            event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (!first || !last) {
            event.preventDefault();
          } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <h2 id={titleId} className="text-heading">
        Delete Vibe?
      </h2>
      <p id={descriptionId} className="mt-3 break-words text-body text-secondary">
        Are you sure you want to delete “{title}”? This can’t be undone.
      </p>
      {error ? (
        <div className="mt-4">
          <Failed error={error} />
        </div>
      ) : null}
      <div className="mt-6 flex justify-end gap-2">
        <Button autoFocus variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          variant="danger"
          aria-label="Confirm delete Vibe"
          onClick={onConfirm}
          disabled={pending}
        >
          {pending ? "Deleting…" : "Delete Vibe"}
        </Button>
      </div>
    </dialog>
  );
}
