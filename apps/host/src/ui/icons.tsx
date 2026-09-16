/**
 * Icons labeled with Figma references retain their exported geometry (viewBox and path data);
 * only the hard-coded stroke and fill colours become `currentColor`, so an icon inherits the
 * tier it is rendered in rather than pinning one tier's palette.
 */
import { useId, type SVGProps } from "react";
import appMark from "../assets/brand/app-mark.png";
// External SVG <use> references must remain file URLs in production.
import vibesMark from "../assets/brand/vibes-mark.svg?no-inline";

type IconProps = SVGProps<SVGSVGElement>;

/** A softly filled sun with eight short rays. */
export function LightModeIcon({ width = 24, height = 24, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" width={width} height={height} aria-hidden {...props}>
      <circle
        cx="12"
        cy="12"
        r="4"
        fill="currentColor"
        fillOpacity="0.08"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M12 2V4M12 20V22M2 12H4M20 12H22M4.9 4.9L6.3 6.3M17.7 17.7L19.1 19.1M4.9 19.1L6.3 17.7M17.7 6.3L19.1 4.9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A crescent moon with a small four-point star. */
export function DarkModeIcon({ width = 24, height = 24, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" width={width} height={height} aria-hidden {...props}>
      <path
        d="M20.5 13.1A8.5 8.5 0 1 1 10.9 3.5A6.5 6.5 0 0 0 20.5 13.1Z"
        fill="currentColor"
        fillOpacity="0.08"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M17.5 2.5L18.3 5.2L21 6L18.3 6.8L17.5 9.5L16.7 6.8L14 6L16.7 5.2L17.5 2.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Four purple circle outlines with violet outlined connections and no lettering. */
export function StartVibeIcon({ width = 19, height = 19, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" width={width} height={height} aria-hidden {...props}>
      <use href={`${vibesMark}#vibes-mark`} />
    </svg>
  );
}

/** Rhizome ring mark — Figma 4856:2076, tinted through the original artwork's alpha. */
export function ImportIcon({ width = 24, height = 24, ...props }: IconProps) {
  const maskId = useId();
  return (
    <svg viewBox="0 0 24 24" fill="none" width={width} height={height} aria-hidden {...props}>
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="24"
          height="24"
          style={{ maskType: "alpha" }}
        >
          <image href={appMark} x="1" y="1" width="22" height="22" />
        </mask>
      </defs>
      <rect width="24" height="24" fill="light-dark(#333, #eee)" mask={`url(#${maskId})`} />
    </svg>
  );
}

/** Right-pointing navigation arrow beside a stored object. */
export function OpenObjectIcon({ width = 22, height = 22, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" width={width} height={height} aria-hidden {...props}>
      <path
        d="M16.5 4.5L23 8.25V15.75L16.5 19.5L10 15.75V8.25L16.5 4.5ZM10 8.25L16.5 12L23 8.25M16.5 12V19.5M1 12H7.5M4.5 9L7.5 12L4.5 15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Twitter bird with an outward arrow alongside it. */
export function OriginalPostIcon({ width = 22, height = 22, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" width={width} height={height} aria-hidden {...props}>
      <path
        fill="currentColor"
        transform="translate(1 6) scale(.64)"
        d="M23.954 4.57a10 10 0 0 1-2.825.775 4.958 4.958 0 0 0 2.163-2.723 9.99 9.99 0 0 1-3.127 1.195 4.916 4.916 0 0 0-8.384 4.482A13.944 13.944 0 0 1 1.64 3.162a4.916 4.916 0 0 0 1.523 6.558 4.903 4.903 0 0 1-2.229-.616v.061a4.917 4.917 0 0 0 3.946 4.818 4.935 4.935 0 0 1-2.224.084 4.923 4.923 0 0 0 4.6 3.419A9.869 9.869 0 0 1 0 19.523a13.94 13.94 0 0 0 7.548 2.212c9.057 0 14.01-7.503 14.01-14.01 0-.213-.005-.425-.014-.636A10.013 10.013 0 0 0 24 4.59z"
      />
      <path
        d="M17.5 16L23 10.5M17.5 10.5H23V16"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
