import {
  forwardRef,
  useId,
  useRef,
  useState,
  type ChangeEventHandler,
  type InputHTMLAttributes,
  type Ref,
} from "react";

import { Button } from "./Button.tsx";
import { cn } from "./cn.ts";

export interface FilePickerProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "children" | "className" | "type"
> {
  buttonLabel?: string;
  className?: string;
  emptyLabel?: string;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

/** Styled file chooser that keeps the native input in the form and accessibility tree. */
export const FilePicker = forwardRef<HTMLInputElement, FilePickerProps>(function FilePicker(
  {
    buttonLabel = "Choose file",
    className,
    disabled,
    emptyLabel = "No file chosen",
    id: providedId,
    onChange,
    ...props
  },
  forwardedRef,
) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const input = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState(emptyLabel);

  const handleChange: ChangeEventHandler<HTMLInputElement> = (event) => {
    const names = Array.from(event.currentTarget.files ?? [], ({ name }) => name);
    setSelection(names.length > 0 ? names.join(", ") : emptyLabel);
    onChange?.(event);
  };

  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <input
        ref={(node) => {
          input.current = node;
          assignRef(forwardedRef, node);
        }}
        id={id}
        type="file"
        disabled={disabled}
        className="sr-only"
        onChange={handleChange}
        {...props}
      />
      <Button
        type="button"
        variant="secondary"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        {buttonLabel}
      </Button>
      <span aria-live="polite" className="min-w-0 truncate text-caption text-secondary">
        {selection}
      </span>
    </div>
  );
});
