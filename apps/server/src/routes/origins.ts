import { RNET_SCHEMA_VERSION, type OriginArtifact } from "@rnet/types";
import { Hono } from "hono";
import { v7 as uuidv7 } from "uuid";

import type { BlobStore } from "../blobs/index.ts";
import type { Database } from "../db/index.ts";
import { OriginArtifactService, type DbOriginArtifact } from "../services/origin-artifacts.ts";
import { ProblemSchema, RecordIdParamsSchema, rnetDocument, rnetRoute } from "./contracts.ts";
import { blobResponse, contentHash, requestMime } from "./http.ts";
import type { AppEnvironment } from "./types.ts";

const OriginArtifactDocumentSchema = rnetDocument("origin-artifact");

export function createOriginRoutes(db: Database, blobs: BlobStore) {
  const router = new Hono<AppEnvironment>();

  router.post(
    "/",
    rnetRoute({
      auth: "user",
      responses: {
        201: OriginArtifactDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        415: ProblemSchema,
      },
    }),
    async (context) => {
      const actor = context.get("actor");
      const originArtifactService = new OriginArtifactService({ db, actor });
      if (actor.kind !== "user") throw new Error("User middleware did not narrow the actor");
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
    rnetRoute({
      request: { param: RecordIdParamsSchema },
      responses: { 200: OriginArtifactDocumentSchema, 422: ProblemSchema },
    }),
    async (context) => {
      const originArtifactService = new OriginArtifactService({ db, actor: context.get("actor") });
      const originArtifact = await originArtifactService.getOriginArtifact(
        context.req.valid("param").id,
      );
      const document = await originArtifactDocument(originArtifact, blobs);
      return context.json(document);
    },
  );
  router.get(
    "/:id/bytes",
    rnetRoute({
      request: { param: RecordIdParamsSchema },
      responses: { 422: ProblemSchema },
    }),
    async (context) => {
      const originArtifactService = new OriginArtifactService({ db, actor: context.get("actor") });
      const originArtifact = await originArtifactService.getOriginArtifact(
        context.req.valid("param").id,
      );
      const blob = await blobs.get("origins", originArtifact.contentHash);
      return blobResponse(context, blob);
    },
  );

  return router;
}

async function originArtifactDocument(
  originArtifact: DbOriginArtifact,
  blobs: BlobStore,
): Promise<OriginArtifact> {
  return {
    rnet_schema: RNET_SCHEMA_VERSION,
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
