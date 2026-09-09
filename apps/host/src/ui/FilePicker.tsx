import {
  forwardRef,
  useId,
  useRef,
  useState,
  type ChangeEventHandler,
  type DragEventHandler,
  type InputHTMLAttributes,
  type Ref,
} from "react";

import { cn } from "./cn.ts";

export interface FilePickerProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "children" | "className" | "type"
> {
  actionLabel?: string;
  className?: string;
  dropLabel?: string;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

/** Dropzone file chooser that keeps the native input in the form and accessibility tree. */
export const FilePicker = forwardRef<HTMLInputElement, FilePickerProps>(function FilePicker(
  {
    actionLabel = "Choose a file",
    className,
    disabled,
    dropLabel = "Drop a file here",
    id: providedId,
    multiple,
    onChange,
    onDragEnter,
    onDragLeave,
    onDragOver,
    onDrop,
    ...props
  },
  forwardedRef,
) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const input = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragActive, setDragActive] = useState(false);
  const [selection, setSelection] = useState<string>();

  const handleChange: ChangeEventHandler<HTMLInputElement> = (event) => {
    const names = Array.from(event.currentTarget.files ?? [], ({ name }) => name);
    setSelection(names.length > 0 ? names.join(", ") : undefined);
    onChange?.(event);
  };

  const handleDragEnter: DragEventHandler<HTMLInputElement> = (event) => {
    event.preventDefault();
    onDragEnter?.(event);
    if (disabled) return;
    dragDepth.current += 1;
    setDragActive(true);
  };

  const handleDragOver: DragEventHandler<HTMLInputElement> = (event) => {
    event.preventDefault();
    onDragOver?.(event);
    if (disabled) return;
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave: DragEventHandler<HTMLInputElement> = (event) => {
    event.preventDefault();
    onDragLeave?.(event);
    if (disabled) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  };

  const handleDrop: DragEventHandler<HTMLInputElement> = (event) => {
    event.preventDefault();
    onDrop?.(event);
    dragDepth.current = 0;
    setDragActive(false);
    if (disabled || !input.current || event.dataTransfer.files.length === 0) return;

    const transfer = new DataTransfer();
    const files = Array.from(event.dataTransfer.files);
    for (const file of multiple ? files : files.slice(0, 1)) transfer.items.add(file);
    input.current.files = transfer.files;
    input.current.dispatchEvent(new Event("change", { bubbles: true }));
  };

  return (
    <div className={cn("min-w-0", className)}>
      <div
        data-file-picker-dropzone
        data-drag-active={dragActive || undefined}
        className={cn(
          "relative flex min-h-36 w-full flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-hairline bg-canvas px-6 py-8 text-center outline-none transition-colors",
          "hover:bg-surface focus-within:outline-2 focus-within:outline-accent",
          dragActive && "border-accent bg-surface",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <input
          ref={(node) => {
            input.current = node;
            assignRef(forwardedRef, node);
          }}
          id={id}
          type="file"
          disabled={disabled}
          multiple={multiple}
          className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          onChange={handleChange}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          {...props}
        />
        <span aria-live="polite" className="max-w-full truncate text-body text-primary">
          {dragActive ? "Drop to select this file" : (selection ?? dropLabel)}
        </span>
        <span aria-hidden className="text-caption text-secondary">
          {actionLabel}
        </span>
      </div>
    </div>
  );
});
