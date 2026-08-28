export type PayloadPresentation = "image" | "audio" | "video" | "text" | "document" | "download";

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
