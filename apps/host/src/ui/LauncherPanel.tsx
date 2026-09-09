import {
  forwardRef,
  useId,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEventHandler,
  type ReactNode,
} from "react";

import { cn } from "./cn.ts";
import { SearchField } from "./SearchField.tsx";

export interface LauncherSection {
  title: string;
  items: ReactNode;
}

export interface LauncherPanelProps {
  /** The same search container grows upward and rightward when open; its input never remounts. */
  open?: boolean;
  /** Result selection closes instantly; other open/close interactions use dock motion. */
  animate?: boolean;
  sections: readonly LauncherSection[];
  query: string;
  onQueryChange: (query: string) => void;
  onOpen?: () => void;
  onInputKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  onDismiss?: () => void;
  className?: string;
}

/**
 * The dock search container keeps its 240 × 48px input mounted and stationary;
 * the container widens to the 308px three-item panel while its expanded contents fade in.
 * Height is intentionally not animated.
 */
export const LauncherPanel = forwardRef<HTMLInputElement, LauncherPanelProps>(
  function LauncherPanel(
    {
      open = true,
      animate = true,
      sections,
      query,
      onQueryChange,
      onOpen,
      onInputKeyDown,
      onDismiss,
      className,
    },
    ref,
  ) {
    const resultsId = useId();
    const hasOpened = useRef(open);
    const lastOpenSections = useRef(sections);

    useLayoutEffect(() => {
      if (!open) return;
      hasOpened.current = true;
      lastOpenSections.current = sections;
    }, [open, sections]);

    // ShellLayout clears the query while closing. Hold the last visible result geometry until
    // the fade finishes so that reset cannot change the panel's height underneath the input.
    const displayedSections = open || !hasOpened.current ? sections : lastOpenSections.current;
    const surfaceStyle = {
      "--rz-launcher-expanded-alpha": open ? 1 : 0,
    } as CSSProperties;
    const surfaceMotion = animate
      ? cn(
          "transition-[--rz-launcher-expanded-alpha,opacity] duration-100",
          open ? "ease-out" : "ease-in",
        )
      : "transition-none";

    return (
      <div
        role={open ? "dialog" : undefined}
        aria-label={open ? "Start something new" : undefined}
        data-launcher-container
        data-expanded={open ? "true" : "false"}
        data-tier="light"
        onKeyDownCapture={(event) => {
          if (!open || event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onDismiss?.();
        }}
        onKeyDown={(event) => {
          if (!open || event.key !== "Tab") return;
          const focusable = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          );
          const first = focusable[0];
          const last = focusable.at(-1);
          if (!first || !last) return;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        className={cn(
          "pointer-events-none absolute bottom-0 left-0 flex max-h-[min(70vh,36rem)] flex-col overflow-hidden rounded-[24px] font-sans",
          animate ? "transition-[width] duration-100 ease-out" : "transition-none",
          open ? "w-[308px]" : "w-60",
          className,
        )}
      >
        <div data-launcher-backdrops aria-hidden className="pointer-events-none absolute inset-0">
          <div
            data-launcher-blur
            style={surfaceStyle}
            className={cn(
              "launcher-surface-mask absolute inset-0 rounded-[24px] opacity-100",
              open ? "backdrop-blur-[24px]" : "backdrop-blur-[20px]",
              surfaceMotion,
            )}
          />
          <div
            data-launcher-surface
            style={surfaceStyle}
            className={cn(
              "launcher-surface-mask absolute inset-0 rounded-[24px] bg-dock-search",
              surfaceMotion,
            )}
          />
        </div>
        <div
          id={resultsId}
          data-launcher-results
          inert={!open}
          aria-hidden={open ? undefined : true}
          className={cn(
            // Lay out against the final width from the first frame. The outer container clips
            // this while widening, so the three-item rails never briefly reflow or wrap.
            "relative z-10 min-h-0 w-[308px] shrink-0 overflow-hidden",
            animate
              ? cn("transition-opacity duration-100", open ? "ease-out" : "ease-in")
              : "transition-none",
            open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <div className="flex max-h-full min-h-0 flex-col gap-6 overflow-y-auto px-6 pt-4 pb-6">
            {displayedSections.map((section) => (
              <div
                key={section.title}
                data-launcher-section={section.title}
                className="flex flex-col gap-2"
              >
                <span className="flex items-center gap-1 text-body-lg font-medium text-primary">
                  {section.title}
                  <span className="size-1.5 rounded-full bg-accent" aria-hidden />
                </span>
                <div
                  data-launcher-item-rail
                  className="flex gap-[22px] overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {section.items}
                </div>
              </div>
            ))}
          </div>
        </div>
        <SearchField
          ref={ref}
          surface="embedded"
          containerClassName="pointer-events-auto relative z-10 shrink-0"
          containerProps={{ "data-launcher-input-row": true }}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onFocus={onOpen}
          onClick={onOpen}
          onKeyDown={onInputKeyDown}
          aria-label="Search everything"
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls={resultsId}
        />
      </div>
    );
  },
);
