import { createMiddleware } from "hono/factory";
import { Hono } from "hono";
import { logger } from "hono/logger";

import type { AppVariables } from "./auth.ts";
import { devAuth } from "./auth.ts";
import type { BlobStore } from "./blobs/index.ts";
import type { ServerConfig } from "./config.ts";
import type { Database } from "./db/index.ts";
import { elements, operations, origins } from "./db/schema.ts";
import { eq } from "drizzle-orm";
import { notFound, Problem, problemResponse } from "./errors.ts";
import { Store, uriId } from "./store.ts";
import { validateSchema, type MediaElement, type OriginArtifact } from "@rnet/types";
import { v7 as uuidv7 } from "uuid";

export interface AppDependencies {
  config: ServerConfig;
  db: Database;
  blobs: BlobStore;
}

export function createApp(dependencies: AppDependencies) {
  const { config, db, blobs } = dependencies;
  const store = new Store(db);
  const app = new Hono<{ Variables: AppVariables }>();

  app.use(logger());
  app.use(
    "*",
    createMiddleware(async (c, next) => {
      await next();
      c.header("Access-Control-Allow-Origin", c.req.header("Origin") ?? "*");
      c.header("Access-Control-Allow-Headers", "Authorization, Content-Type, If-Match, X-Rnet-Kind, X-Rnet-Label, X-Rnet-Vibe");
      c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
      c.header("Vary", "Origin");
    }),
  );
  app.options("*", (c) => c.body(null, 204));
  app.use("/rnet/*", devAuth);

  app.onError((error, c) => {
    if (error instanceof Problem) return problemResponse(c, error);
    console.error(error);
    return problemResponse(
      c,
      new Problem(500, "internal_error", "Internal error", "The store could not complete the request"),
    );
  });
  app.notFound((c) => problemResponse(c, notFound("Route")));

  app.get("/health", (c) => c.json({ ok: true, service: "rhizome" }));

  app.get("/rnet/v0/vibes", async (c) => c.json({ items: await store.listVibes(c.get("actor")) }));
  app.post("/rnet/v0/vibes", async (c) => {
    const body = await jsonBody(c);
    return c.json(await store.createVibe(c.get("actor"), body), 201);
  });
  app.get("/rnet/v0/vibes/:id", async (c) => c.json(await store.getVibe(c.get("actor"), c.req.param("id"))));
  app.patch("/rnet/v0/vibes/:id", async (c) => {
    const body = await jsonBody(c);
    return c.json(await store.updateVibe(c.get("actor"), c.req.param("id"), body));
  });
  app.delete("/rnet/v0/vibes/:id", async (c) => {
    await store.deleteVibe(c.get("actor"), c.req.param("id"));
    return c.body(null, 204);
  });
  app.get("/rnet/v0/vibes/:id/objects", async (c) => {
    const items = await store.listVibeObjects(c.get("actor"), c.req.param("id"));
    return c.json({ items });
  });
  app.post("/rnet/v0/vibes/:id/objects", async (c) => {
    const body = await jsonBody(c);
    await store.addObjectRefs(c.get("actor"), c.req.param("id"), body.objects);
    return c.body(null, 204);
  });
  app.delete("/rnet/v0/vibes/:id/objects", async (c) => {
    const body = await jsonBody(c);
    await store.removeObjectRefs(c.get("actor"), c.req.param("id"), body.objects);
    return c.body(null, 204);
  });

  app.post("/rnet/v0/objects", async (c) => {
    const body = await jsonBody(c);
    return c.json({ items: await store.createObjects(c.get("actor"), body) }, 201);
  });
  app.get("/rnet/v0/objects/:id", async (c) => {
    const result = await store.getObject(c.get("actor"), c.req.param("id"));
    c.header("ETag", `"${result.userRev}"`);
    return c.json(result.document);
  });
  app.patch("/rnet/v0/objects/:id/user", async (c) => {
    const header = c.req.header("If-Match");
    if (header === undefined) {
      throw new Problem(409, "revision_conflict", "Revision required", "If-Match is required");
    }
    const expected = Number(header.replaceAll('"', ""));
    if (!Number.isInteger(expected) || expected < 0) {
      throw new Problem(409, "revision_conflict", "Invalid revision", "If-Match must be an integer revision");
    }
    const result = await store.setUser(c.get("actor"), c.req.param("id"), expected, await jsonBody(c));
    c.header("ETag", `"${result.userRev}"`);
    return c.json(result.document);
  });
  app.put("/rnet/v0/objects/:id/inferred", async (c) => {
    return c.json(await store.setInferred(c.get("actor"), c.req.param("id"), await jsonBody(c)));
  });

  app.post("/rnet/v0/origins", async (c) => {
    const actor = c.get("actor");
    await store.assertOwner(actor);
    if (actor.kind !== "user") throw new Error("Owner assertion did not narrow to a user");
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const mime = requestMime(c.req.header("Content-Type"));
    const contentHashValue = await contentHash(bytes);
    const uuid = uuidv7();
    await blobs.put("origins", contentHashValue, bytes, mime);
    const [row] = await db
      .insert(origins)
      .values({
        uuid,
        ownerUuid: actor.uuid,
        contentHash: contentHashValue,
        mime,
        byteSize: bytes.byteLength,
        label: c.req.header("X-Rnet-Label"),
        rnetSchema: "0.1",
      })
      .returning();
    if (!row) throw new Error("Origin metadata was not stored");
    const document: OriginArtifact = {
      rnet_schema: "0.1",
      uri: `rnet://origin/${row.uuid}`,
      owner: `rnet://id/${row.ownerUuid}`,
      content_hash: row.contentHash,
      mime: row.mime,
      bytes: await blobs.signedUrl("origins", row.contentHash),
      byte_size: row.byteSize,
      ...(row.label ? { label: row.label } : {}),
      uploaded_at: row.uploadedAt.toISOString(),
    };
    assertDocument("origin-artifact", document);
    return c.json(document, 201);
  });
  app.get("/rnet/v0/origins/:id", async (c) => {
    const uuid = normalizedUuid(c.req.param("id"));
    const [row] = await db.select().from(origins).where(eq(origins.uuid, uuid));
    if (!row || row.tombstonedAt) throw notFound("Origin");
    await store.assertRecordOwner(c.get("actor"), row.ownerUuid);
    return c.json({
      rnet_schema: "0.1",
      uri: `rnet://origin/${row.uuid}`,
      owner: `rnet://id/${row.ownerUuid}`,
      content_hash: row.contentHash,
      mime: row.mime,
      bytes: await blobs.signedUrl("origins", row.contentHash),
      byte_size: row.byteSize,
      ...(row.label ? { label: row.label } : {}),
      uploaded_at: row.uploadedAt.toISOString(),
    } satisfies OriginArtifact);
  });
  app.get("/rnet/v0/origins/:id/bytes", async (c) => {
    const uuid = normalizedUuid(c.req.param("id"));
    const [row] = await db.select().from(origins).where(eq(origins.uuid, uuid));
    if (!row || row.tombstonedAt) throw notFound("Origin");
    await store.assertRecordOwner(c.get("actor"), row.ownerUuid);
    return blobResponse(c, await blobs.get("origins", row.contentHash));
  });

  app.post("/rnet/v0/elements", async (c) => {
    const actor = c.get("actor");
    await store.assertAuthenticated(actor);
    let uploadVibeUuid: string | undefined;
    let ownerUuid: string;
    if (actor.kind === "client") {
      const vibe = c.req.header("X-Rnet-Vibe");
      if (!vibe) throw new Problem(403, "grant_missing", "Grant context missing", "X-Rnet-Vibe is required", { scope: "write:objects" });
      uploadVibeUuid = normalizedUuid(uriId(vibe));
      ownerUuid = (await store.assertVibeScope(actor, uploadVibeUuid, "write:objects")).ownerUuid;
    } else if (actor.kind === "user") {
      ownerUuid = actor.uuid;
    } else {
      throw new Error("Authentication assertion did not narrow to a user or client");
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const mime = requestMime(c.req.header("Content-Type"));
    const kind = c.req.header("X-Rnet-Kind");
    const contentHashValue = await contentHash(bytes);
    const uuid = uuidv7();
    const candidate = {
      rnet_schema: "0.1",
      uri: `rnet://element/${uuid}`,
      owner: `rnet://id/${ownerUuid}`,
      content_hash: contentHashValue,
      kind,
      mime,
      bytes: await blobs.signedUrl("elements", contentHashValue),
      byte_size: bytes.byteLength,
      created_at: new Date().toISOString(),
    };
    const validation = validateSchema("media-element", candidate);
    if (!validation.ok) {
      throw new Problem(422, "schema_violation", "Schema violation", "The element metadata does not conform", { errors: validation.issues });
    }
    await blobs.put("elements", contentHashValue, bytes, mime);
    const [row] = await db
      .insert(elements)
      .values({
        uuid,
        ownerUuid,
        contentHash: contentHashValue,
        kind: validation.value.kind,
        mime,
        byteSize: bytes.byteLength,
        rnetSchema: "0.1",
        createdBy: actor.subject,
        createdForVibe: actor.kind === "client" ? uploadVibeUuid : null,
      })
      .returning();
    if (!row) throw new Error("Element metadata was not stored");
    return c.json(validation.value, 201);
  });
  app.get("/rnet/v0/elements/:id", async (c) => {
    const uuid = normalizedUuid(c.req.param("id"));
    if (!(await store.canReadElement(c.get("actor"), uuid))) throw new Problem(403, "grant_missing", "Grant missing", "The read scope is required", { scope: "read" });
    const [row] = await db.select().from(elements).where(eq(elements.uuid, uuid));
    if (!row || row.tombstonedAt) throw notFound("Element");
    return c.json({
      rnet_schema: "0.1",
      uri: `rnet://element/${row.uuid}`,
      owner: `rnet://id/${row.ownerUuid}`,
      content_hash: row.contentHash,
      kind: row.kind as MediaElement["kind"],
      mime: row.mime,
      bytes: await blobs.signedUrl("elements", row.contentHash),
      byte_size: row.byteSize,
      created_at: row.createdAt.toISOString(),
    } satisfies MediaElement);
  });
  app.get("/rnet/v0/elements/:id/bytes", async (c) => {
    const uuid = normalizedUuid(c.req.param("id"));
    if (!(await store.canReadElement(c.get("actor"), uuid))) throw new Problem(403, "grant_missing", "Grant missing", "The read scope is required", { scope: "read" });
    const [row] = await db.select().from(elements).where(eq(elements.uuid, uuid));
    if (!row || row.tombstonedAt) throw notFound("Element");
    return blobResponse(c, await blobs.get("elements", row.contentHash));
  });

  app.post("/rnet/v0/vibes/:id/push", async (c) => {
    await store.assertVibeScope(c.get("actor"), c.req.param("id"), "push");
    throw new Problem(501, "not_implemented", "Push is scheduled for M3", "The operation record exists in M1; model execution lands in M3");
  });
  app.post("/rnet/v0/vibes/:id/pull", async (c) => {
    await store.assertVibeScope(c.get("actor"), c.req.param("id"), "pull");
    throw new Problem(501, "not_implemented", "Pull is scheduled for M2", "Compiled ingestion lands in M2");
  });
  app.get("/rnet/v0/operations/:id", async (c) => {
    const [row] = await db.select().from(operations).where(eq(operations.uuid, c.req.param("id")));
    if (!row) throw notFound("Operation");
    if (row.vibeUuid) await store.assertVibeScope(c.get("actor"), row.vibeUuid, "read");
    else await store.assertAuthenticated(c.get("actor"));
    return c.json({
      operation_id: row.uuid,
      kind: row.kind,
      status: row.status,
      request: row.request,
      result: row.result,
      error: row.error,
      created_at: row.createdAt.toISOString(),
      finished_at: row.finishedAt?.toISOString(),
    });
  });

  return { app, store };
}

async function jsonBody(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown>> {
  const body = await c.req.json().catch(() => {
    throw new Problem(422, "schema_violation", "Invalid JSON", "The request body must be JSON");
  });
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Problem(422, "schema_violation", "Schema violation", "The request body must be an object");
  }
  return body as Record<string, unknown>;
}

function requestMime(value?: string): string {
  const mime = value?.split(";", 1)[0]?.trim();
  if (!mime) throw new Problem(415, "mime_required", "Media type required", "Content-Type is required");
  return mime;
}

async function contentHash(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer));
  return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function normalizedUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw notFound("Record");
  }
  return value;
}

function assertDocument(schema: "origin-artifact", value: unknown): void {
  const result = validateSchema(schema, value);
  if (!result.ok) throw new Error(`Store produced an invalid ${schema}: ${JSON.stringify(result.issues)}`);
}

function blobResponse(c: { body(body: Uint8Array, status?: number, headers?: Record<string, string>): Response }, blob: Awaited<ReturnType<BlobStore["get"]>>): Response {
  if (!blob) throw notFound("Blob");
  return c.body(blob.bytes, 200, {
    "Content-Type": blob.contentType ?? "application/octet-stream",
    "Cache-Control": "private, max-age=900",
  });
}
