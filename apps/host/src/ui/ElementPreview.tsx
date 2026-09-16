import { useEffect, useState, type ReactNode } from "react";

import { Badge } from "./Badge.tsx";
import { cn } from "./cn.ts";

export type PayloadPresentation = "image" | "audio" | "video" | "text" | "document" | "download";

export interface PayloadCandidate {
  element: {
    kind: string;
    mime: string;
  };
  index: number;
  role?: "title" | "content" | "preview";
}

/** Choose a browser-native payload renderer from the stored media type. */
export function payloadPresentation(mime: string): PayloadPresentation {
  const mediaType = mime.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (mediaType.startsWith("image/")) return "image";
  if (mediaType.startsWith("audio/")) return "audio";
  if (mediaType.startsWith("video/")) return "video";
  if (mediaType.startsWith("text/")) return "text";
  if (
    mediaType === "application/json" ||
    mediaType === "application/xml" ||
    mediaType === "application/javascript"
  ) {
    return "text";
  }
  if (mediaType === "application/pdf") return "document";
  return "download";
}

function isNativePresentation(candidate: PayloadCandidate): boolean {
  const presentation = payloadPresentation(candidate.element.mime);
  return presentation !== "download" && candidate.element.kind === presentation;
}

function presentationPriority(candidate: PayloadCandidate): number {
  const presentation = payloadPresentation(candidate.element.mime);
  const mediaType = candidate.element.mime.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const nativePriority = !isNativePresentation(candidate)
    ? 4
    : presentation === "image" || presentation === "audio" || presentation === "video"
      ? 0
      : presentation === "document"
        ? 1
        : presentation === "text" && mediaType !== "text/plain"
          ? 2
          : 3;
  return nativePriority + (candidate.role === "title" ? 10 : 0);
}

/** Select one card preview without assigning provider-specific meaning to element positions. */
export function primaryPayloadCandidate<T extends PayloadCandidate>(
  candidates: readonly T[],
): T | undefined {
  let primary: T | undefined;
  let primaryPriority = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const candidatePriority = presentationPriority(candidate);
    if (
      !primary ||
      candidatePriority < primaryPriority ||
      (candidatePriority === primaryPriority && candidate.index < primary.index)
    ) {
      primary = candidate;
      primaryPriority = candidatePriority;
    }
  }
  return primary;
}

export interface ElementPreviewProps {
  borderTone?: "hairline" | "accent-secondary";
  title: string;
  kind?: string;
  mime?: string;
  src?: string;
  variant?: "card" | "detail" | "thumbnail";
  isPending?: boolean;
  isError?: boolean;
  loadingLabel?: string;
  errorLabel?: string;
  fallbackLabel?: string;
  fallbackDetail?: ReactNode;
  frameTitle?: string;
  className?: string;
}

function fallback(
  label: string,
  detail: ReactNode,
  className: string | undefined,
  presentation: string,
) {
  return (
    <span
      data-element-presentation={presentation}
      data-media-object-presentation={presentation}
      className={cn("flex max-w-[80%] flex-col items-center gap-2 text-center", className)}
    >
      <Badge>{label}</Badge>
      <span className="text-body text-primary">{detail}</span>
    </span>
  );
}

function TextElementPreview({
  className,
  errorLabel,
  frameBorder,
  frameTitle,
  loadingLabel,
  src,
  title,
  variant,
}: {
  className?: string;
  errorLabel: string;
  frameBorder: string;
  frameTitle?: string;
  loadingLabel: string;
  src: string;
  title: string;
  variant: NonNullable<ElementPreviewProps["variant"]>;
}) {
  const [current, setCurrent] = useState<
    { src: string; status: "loaded"; text: string } | { src: string; status: "error" } | null
  >(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(src, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Text payload returned ${response.status}`);
        const bytes = await response.arrayBuffer();
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      })
      .then(
        (text) => {
          if (!controller.signal.aborted) setCurrent({ src, status: "loaded", text });
        },
        () => {
          if (!controller.signal.aborted) setCurrent({ src, status: "error" });
        },
      );
    return () => controller.abort();
  }, [src]);

  const state = current?.src === src ? current : null;
  return (
    <pre
      data-element-presentation="text"
      data-media-object-presentation="text"
      title={frameTitle ?? `Text content for ${title}`}
      aria-busy={!state}
      className={cn(
        "m-0 overflow-auto whitespace-pre-wrap break-words bg-canvas text-left font-mono text-primary",
        variant === "card" ? "size-full border-0 p-3" : "h-72 w-full rounded-sm border p-4",
        variant !== "card" && frameBorder,
        className,
      )}
    >
      {!state ? loadingLabel : state.status === "error" ? errorLabel : state.text}
    </pre>
  );
}

/** Shared browser-native renderer for stored and staged media elements. */
export function ElementPreview({
  borderTone = "hairline",
  className,
  errorLabel = "Content unavailable",
  fallbackDetail,
  fallbackLabel = "media",
  frameTitle,
  isError = false,
  isPending = false,
  kind,
  loadingLabel = "Loading content…",
  mime,
  src,
  title,
  variant = "card",
}: ElementPreviewProps) {
  const frameBorder =
    borderTone === "accent-secondary" ? "border-accent-secondary" : "border-hairline";

  if (!kind || !mime) {
    if (isPending) return <span className="text-caption text-tertiary">{loadingLabel}</span>;
    if (isError) return <span className="text-caption text-tertiary">{errorLabel}</span>;
    return fallback(fallbackLabel, fallbackDetail ?? "No stored payload", className, "link");
  }

  const presentation = payloadPresentation(mime);
  const native = presentation !== "download" && kind === presentation;
  if (!src) {
    if (isError) return <span className="text-caption text-tertiary">{errorLabel}</span>;
    return <span className="text-caption text-tertiary">{loadingLabel}</span>;
  }
  if (!native) {
    if (variant === "detail") {
      return (
        <span className={cn("text-body text-tertiary", className)}>
          This payload has no browser-native preview.
        </span>
      );
    }
    return fallback(fallbackLabel, fallbackDetail ?? mime, className, "download");
  }

  if (presentation === "image") {
    return (
      <img
        data-element-presentation="image"
        data-media-object-presentation="image"
        src={src}
        alt={title}
        className={cn(
          variant === "card"
            ? "size-full object-contain transition-transform duration-300 group-hover:scale-[1.02]"
            : variant === "thumbnail"
              ? "size-full object-cover"
              : "max-h-96 max-w-full rounded-sm border object-contain",
          variant === "detail" && frameBorder,
          className,
        )}
      />
    );
  }
  if (presentation === "audio") {
    return (
      <audio
        data-element-presentation="audio"
        data-media-object-presentation="audio"
        src={src}
        controls
        aria-label={`Audio for ${title}`}
        className={cn(
          variant === "card" ? "w-[80%]" : "w-full rounded-sm border",
          variant !== "card" && frameBorder,
          className,
        )}
      />
    );
  }
  if (presentation === "video") {
    return (
      <video
        data-element-presentation="video"
        data-media-object-presentation="video"
        src={src}
        controls
        aria-label={`Video for ${title}`}
        className={cn(
          variant === "card"
            ? "size-full object-contain"
            : "max-h-96 w-full rounded-sm border bg-black",
          variant !== "card" && frameBorder,
          className,
        )}
      />
    );
  }

  if (presentation === "text") {
    return (
      <TextElementPreview
        className={className}
        errorLabel={errorLabel}
        frameBorder={frameBorder}
        frameTitle={frameTitle}
        loadingLabel={loadingLabel}
        src={src}
        title={title}
        variant={variant}
      />
    );
  }

  return (
    <iframe
      data-element-presentation={presentation}
      data-media-object-presentation={presentation}
      src={src}
      title={frameTitle ?? `Document preview for ${title}`}
      sandbox=""
      className={cn(
        variant === "card"
          ? "size-full border-0 bg-white"
          : "h-72 w-full rounded-sm border bg-white",
        variant !== "card" && frameBorder,
        className,
      )}
    />
  );
}
