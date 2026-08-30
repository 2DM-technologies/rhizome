export type PayloadPresentation = "image" | "audio" | "video" | "text" | "document" | "download";

export interface PayloadCandidate {
  element: {
    kind: string;
    mime: string;
  };
  index: number;
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

  // Prefer content the card can present directly. Rich media shares a rank so source order
  // remains the tie-breaker; structured text is more useful as a preview than plain text.
  if (!isNativePresentation(candidate)) return 4;
  return presentation === "image" || presentation === "audio" || presentation === "video"
    ? 0
    : presentation === "document"
      ? 1
      : presentation === "text" && mediaType !== "text/plain"
        ? 2
        : 3;
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
