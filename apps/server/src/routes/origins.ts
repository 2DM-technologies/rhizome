import type { OriginArtifact } from "@rnet/types";
import { Hono } from "hono";
import { v7 as uuidv7 } from "uuid";

import type { BlobStore } from "../blobs/index.ts";
import type { DbOriginArtifact } from "../services/origin-artifacts.ts";
import type { Services } from "../services/index.ts";
import { defineRoute, jsonResponse, rnetDocument } from "./contracts.ts";
import { blobResponse, contentHash, normalizedUuid, requestMime } from "./http.ts";
import type { AppEnvironment } from "./types.ts";

const originArtifactDocumentSchema = rnetDocument("origin-artifact");
const createOriginArtifactRoute = defineRoute({ responses: { 201: originArtifactDocumentSchema } });
const getOriginArtifactRoute = defineRoute({ responses: { 200: originArtifactDocumentSchema } });

export function createOriginRoutes(services: Services, blobs: BlobStore) {
  const router = new Hono<AppEnvironment>();

  router.post("/", async (context) => {
    const actor = context.get("actor");
    await services.access.assertVibeOwner(actor);
    if (actor.kind !== "user") throw new Error("Owner assertion did not narrow to a user");
    const bytes = new Uint8Array(await context.req.arrayBuffer());
    const mime = requestMime(context.req.header("Content-Type"));
    const contentHashValue = await contentHash(bytes);
    const originArtifactUuid = uuidv7();
    await blobs.put("origins", contentHashValue, bytes, mime);
    const originArtifact = await services.originArtifacts.createOriginArtifact(actor, {
      uuid: originArtifactUuid,
      ownerUuid: actor.uuid,
      contentHash: contentHashValue,
      mime,
      byteSize: bytes.byteLength,
      label: context.req.header("X-Rnet-Label"),
    });
    const document = await originArtifactDocument(originArtifact, blobs);
    return jsonResponse(context, createOriginArtifactRoute, 201, document);
  });
  router.get("/:id", async (context) => {
    const originArtifact = await services.originArtifacts.getOriginArtifact(
      context.get("actor"),
      normalizedUuid(context.req.param("id")),
    );
    return jsonResponse(
      context,
      getOriginArtifactRoute,
      200,
      await originArtifactDocument(originArtifact, blobs),
    );
  });
  router.get("/:id/bytes", async (context) => {
    const originArtifact = await services.originArtifacts.getOriginArtifact(
      context.get("actor"),
      normalizedUuid(context.req.param("id")),
    );
    return blobResponse(context, await blobs.get("origins", originArtifact.contentHash));
  });

  return router;
}

async function originArtifactDocument(
  originArtifact: DbOriginArtifact,
  blobs: BlobStore,
): Promise<OriginArtifact> {
  return {
    rnet_schema: "0.1",
    uri: `rnet://origin/${originArtifact.uuid}`,
    owner: `rnet://id/${originArtifact.ownerUuid}`,
    content_hash: originArtifact.contentHash,
    mime: originArtifact.mime,
    bytes: await blobs.signedUrl("origins", originArtifact.contentHash),
    byte_size: originArtifact.byteSize,
    ...(originArtifact.label ? { label: originArtifact.label } : {}),
    uploaded_at: originArtifact.uploadedAt.toISOString(),
  };
}
