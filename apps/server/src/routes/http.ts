import { UUIDV7_PATTERN } from "@rnet/types";
import type { Context, Input } from "hono";

import type { BlobStore } from "../blobs/index.ts";
import { notFound, Problem } from "../errors.ts";
import type { AppEnvironment } from "./types.ts";

export function requestMime(value?: string): string {
  const mime = value?.split(";", 1)[0]?.trim();
  if (!mime)
    throw new Problem(415, "mime_required", "Media type required", "Content-Type is required");
  return mime;
}

export function normalizedUuid(value: string): string {
  if (!new RegExp(UUIDV7_PATTERN).test(value)) {
    throw notFound("Record");
  }
  return value;
}

export function blobResponse<
  Environment extends AppEnvironment,
  Path extends string,
  Body extends Input,
>(
  context: Context<Environment, Path, Body>,
  blob: Awaited<ReturnType<BlobStore["get"]>>,
  contentType: string,
): Response {
  if (!blob) throw notFound("Blob");
  return context.body(new Uint8Array(blob.bytes), 200, {
    "Content-Type": contentType,
    "Cache-Control": "private, no-store",
  });
}
