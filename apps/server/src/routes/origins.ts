import type { OriginArtifact } from "@rnet/types";
import { Hono } from "hono";
import { v7 as uuidv7 } from "uuid";

import type { BlobStore } from "../blobs/index.ts";
import type { Database } from "../db/index.ts";
import { AccessService } from "../services/access.ts";
import { OriginArtifactService, type DbOriginArtifact } from "../services/origin-artifacts.ts";
import { problemSchema, rnetDocument, rnetRoute } from "./contracts.ts";
import { blobResponse, contentHash, normalizedUuid, requestMime } from "./http.ts";
import type { AppEnvironment } from "./types.ts";

const originArtifactDocumentSchema = rnetDocument("origin-artifact");

export function createOriginRoutes(db: Database, blobs: BlobStore) {
  const router = new Hono<AppEnvironment>();

  router.post(
    "/",
    rnetRoute({ responses: { 201: originArtifactDocumentSchema, 415: problemSchema } }),
    async (context) => {
      const actor = context.get("actor");
      const accessService = new AccessService({ db, actor });
      const originArtifactService = new OriginArtifactService({ db, actor });
      await accessService.assertVibeOwner();
      if (actor.kind !== "user") throw new Error("Owner assertion did not narrow to a user");
      const bytes = new Uint8Array(await context.req.arrayBuffer());
      const mime = requestMime(context.req.header("Content-Type"));
      const contentHashValue = await contentHash(bytes);
      const originArtifactUuid = uuidv7();
      await blobs.put("origins", contentHashValue, bytes, mime);
      const originArtifact = await originArtifactService.createOriginArtifact({
        uuid: originArtifactUuid,
        ownerUuid: actor.uuid,
        contentHash: contentHashValue,
        mime,
        byteSize: bytes.byteLength,
        label: context.req.header("X-Rnet-Label"),
      });
      const document = await originArtifactDocument(originArtifact, blobs);
      return context.json(document, 201);
    },
  );
  router.get(
    "/:id",
    rnetRoute({ responses: { 200: originArtifactDocumentSchema } }),
    async (context) => {
      const originArtifactService = new OriginArtifactService({ db, actor: context.get("actor") });
      const originArtifact = await originArtifactService.getOriginArtifact(
        normalizedUuid(context.req.param("id")),
      );
      return context.json(await originArtifactDocument(originArtifact, blobs));
    },
  );
  router.get("/:id/bytes", async (context) => {
    const originArtifactService = new OriginArtifactService({ db, actor: context.get("actor") });
    const originArtifact = await originArtifactService.getOriginArtifact(
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
