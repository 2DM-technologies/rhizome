import { validateSchema } from "@rnet/types";
import type { Context } from "hono";

import type { BlobStore } from "../blobs/index.ts";
import { notFound, Problem } from "../errors.ts";
import type { AppEnvironment } from "./types.ts";

export async function jsonBody(context: Context<AppEnvironment>): Promise<Record<string, unknown>> {
  const body = await context.req.json().catch(() => {
    throw new Problem(422, "schema_violation", "Invalid JSON", "The request body must be JSON");
  });
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Problem(422, "schema_violation", "Schema violation", "The request body must be an object");
  }
  return body as Record<string, unknown>;
}

export function requestMime(value?: string): string {
  const mime = value?.split(";", 1)[0]?.trim();
  if (!mime) throw new Problem(415, "mime_required", "Media type required", "Content-Type is required");
  return mime;
}

export async function contentHash(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer));
  return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function normalizedUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw notFound("Record");
  }
  return value;
}

export function assertDocument(schema: "origin-artifact", value: unknown): void {
  const result = validateSchema(schema, value);
  if (!result.ok) throw new Error(`Store produced an invalid ${schema}: ${JSON.stringify(result.issues)}`);
}

export function blobResponse(
  context: Context<AppEnvironment>,
  blob: Awaited<ReturnType<BlobStore["get"]>>,
): Response {
  if (!blob) throw notFound("Blob");
  return context.body(new Uint8Array(blob.bytes), 200, {
    "Content-Type": blob.contentType ?? "application/octet-stream",
    "Cache-Control": "private, max-age=900",
  });
}
