/**
 * Icons labeled with Figma references retain their exported geometry (viewBox and path data);
 * only the hard-coded stroke and fill colours become `currentColor`, so an icon inherits the
 * tier it is rendered in rather than pinning one tier's palette.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

/** Inline title editing. */
export function EditIcon({ width = 18, height = 18, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 18 18" fill="none" width={width} height={height} aria-hidden {...props}>
      <path
        d="M10.5 4.5L13.5 7.5M3 15L4 11L12.5 2.5A2.12 2.12 0 0 1 15.5 5.5L7 14L3 15Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** icon/search — Figma 4859:277 */
export function SearchIcon({ width = 18, height = 18, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 18 18" fill="none" width={width} height={height} aria-hidden {...props}>
      <circle cx="6.25" cy="6.25" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M11.5 11.5L16.5 16.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** icon/more — Figma 4859:286 */
export function MoreIcon({ width = 18, height = 4, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 18 4" fill="none" width={width} height={height} aria-hidden {...props}>
      <circle cx="2" cy="2" r="2" fill="currentColor" />
      <circle cx="9" cy="2" r="2" fill="currentColor" />
      <circle cx="16" cy="2" r="2" fill="currentColor" />
    </svg>
  );
}

/** Send arrow — Figma 4861:46. The pill behind it belongs to the button, not the glyph. */
export function SendArrowIcon({ width = 28, height = 28, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 28 28" fill="none" width={width} height={height} aria-hidden {...props}>
      <path
        d="M14 19V9M19 13.5L14 9L9 13.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Select chevron — Figma 4892:79 */
export function ChevronDownIcon({ width = 10.6, height = 6.1, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 10.6 6.1" fill="none" width={width} height={height} aria-hidden {...props}>
      <path
        d="M0.8 0.8L5.3 5.3L9.8 0.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Menu Item check — Figma 4892:81 */
export function CheckIcon({ width = 11.8, height = 9.3, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 11.8 9.3" fill="none" width={width} height={height} aria-hidden {...props}>
      <path
        d="M0.9 4.90001L4.4 8.40001L10.9 0.900014"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Window presentation controls. */
export function BackIcon({ width = 18, height = 18, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 18 18" fill="none" width={width} height={height} aria-hidden {...props}>
      <path
        d="M14.5 9H3.5M8 4.5L3.5 9L8 13.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MaximizeIcon({ width = 18, height = 18, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 18 18" fill="none" width={width} height={height} aria-hidden {...props}>
      <path
        d="M8 8L3.5 3.5M3.5 7V3.5H7M10 10L14.5 14.5M11 14.5H14.5V11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function RestoreIcon({ width = 18, height = 18, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 18 18" fill="none" width={width} height={height} aria-hidden {...props}>
      <path
        d="M3.5 3.5L8 8M8 4.5V8H4.5M14.5 14.5L10 10M10 13.5V10H13.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CloseIcon({ width = 18, height = 18, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 18 18" fill="none" width={width} height={height} aria-hidden {...props}>
      <path
        d="M4.5 4.5L13.5 13.5M13.5 4.5L4.5 13.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
