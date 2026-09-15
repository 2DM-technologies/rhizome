import type { MediaObject } from "@rnet/types";
import { useEffect, useState } from "react";

import { uuidOf } from "../api/uris.ts";
import { useElementThumbnailUrl, useMediaElement, usePayloadUrl } from "../queries/index.ts";

const MAX_TEXT_PREVIEW_BYTES = 16 * 1024;

function elementReference(object: MediaObject) {
  return (
    object.elements.find(({ role }) => role === "preview") ??
    object.elements.find(({ role }) => role === "content") ??
    object.elements[0]
  );
}

function payloadKind(mime: string | undefined): "image" | "video" | "text" | "other" {
  const mediaType = mime?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (mediaType.startsWith("image/")) return "image";
  if (mediaType.startsWith("video/")) return "video";
  if (
    mediaType.startsWith("text/") ||
    mediaType === "application/json" ||
    mediaType === "application/xml" ||
    mediaType === "application/javascript"
  ) {
    return "text";
  }
  return "other";
}

function TextThumbnail({ src, size }: { src: string; size: number }) {
  const [current, setCurrent] = useState<
    { src: string; status: "loaded"; text: string } | { src: string; status: "error" } | null
  >(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(src, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Text payload returned ${response.status}`);
        return response.text();
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
    <span
      data-element-presentation="text"
      style={{ fontSize: size / 8 }}
      className="block size-full overflow-hidden whitespace-pre-wrap break-all bg-canvas p-px font-mono leading-[1.05] text-primary"
    >
      {!state ? "" : state.status === "loaded" ? state.text : "Text"}
    </span>
  );
}

/** Small cached images/text only; videos and oversized text use a metadata placeholder. */
export function MediaObjectThumbnail({
  object,
  size = 24,
}: {
  object?: MediaObject;
  size?: number;
}) {
  const reference = object ? elementReference(object) : undefined;
  const elementUuid = reference ? uuidOf(reference.uri) : undefined;
  const element = useMediaElement(elementUuid);
  const presentation = payloadKind(element.data?.mime);
  const thumbnail = useElementThumbnailUrl(presentation === "image" ? elementUuid : undefined);
  const payload = usePayloadUrl(
    "elements",
    presentation === "text" &&
      typeof element.data?.byte_size === "number" &&
      element.data.byte_size <= MAX_TEXT_PREVIEW_BYTES
      ? elementUuid
      : undefined,
    { gcTime: 5 * 60 * 1000 },
  );

  return (
    <span
      data-object-thumbnail
      className="block shrink-0 overflow-hidden border border-neutral-border bg-canvas/60"
      style={{ width: size, height: size }}
    >
      {thumbnail.data && presentation === "image" ? (
        <img
          src={thumbnail.data}
          alt=""
          aria-hidden
          data-element-presentation="image"
          className="size-full object-cover"
        />
      ) : payload.data && presentation === "text" ? (
        <TextThumbnail src={payload.data} size={size} />
      ) : (
        <span
          className="flex size-full items-center justify-center overflow-hidden font-medium uppercase leading-none text-secondary"
          style={{ fontSize: size / 4 }}
        >
          {element.data?.kind?.slice(0, 1) ?? object?.type.slice(0, 1) ?? "o"}
        </span>
      )}
    </span>
  );
}
