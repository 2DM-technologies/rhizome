import type { MediaElement } from "@rnet/types";
import { Hono } from "hono";

import type { BlobStore } from "../blobs/index.ts";
import type { Database } from "../db/index.ts";
import { RNET_SCHEMA_VERSION } from "../rnet.ts";
import { MediaElementsService, type DbMediaElement } from "../services/media-element-service.ts";
import {
  BinaryRequest,
  ProblemSchema,
  RecordIdParamsSchema,
  binaryResponse,
  rnetDocument,
  rnetRoute,
} from "./contracts.ts";
import { blobResponse, requestMime } from "./http.ts";
import type { AppEnvironment } from "./types.ts";

const MediaElementDocumentSchema = rnetDocument("media-element");

export function createMediaElementRoutes(db: Database, blobs: BlobStore) {
  const router = new Hono<AppEnvironment>();

  router.post(
    "/",
    rnetRoute({
      operationId: "createMediaElement",
      auth: "user",
      request: { binary: BinaryRequest },
      responses: {
        201: MediaElementDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        422: ProblemSchema,
      },
    }),
    async (context) => {
      const actor = context.get("actor");
      const mediaElementsService = new MediaElementsService({ db, actor, blobs });
      const ownerUuid = actor.uuid;
      const bytes = new Uint8Array(await context.req.arrayBuffer());
      const mime = requestMime(context.req.header("Content-Type"));
      const kind = context.req.header("X-Rnet-Kind");
      const mediaElement = await mediaElementsService.createMediaElement({
        ownerUuid,
        mediaElementUpload: { bytes, mime, kind },
      });
      return context.json(mediaElement, 201);
    },
  );
  router.get(
    "/:id",
    rnetRoute({
      operationId: "getMediaElement",
      request: { param: RecordIdParamsSchema },
      responses: { 200: MediaElementDocumentSchema, 422: ProblemSchema },
    }),
    async (context) => {
      const mediaElementsService = new MediaElementsService({ db, actor: context.get("actor") });
      const mediaElement = await mediaElementsService.getMediaElement(
        context.req.valid("param").id,
      );
      const document = await mediaElementDocument(mediaElement, blobs);
      return context.json(document);
    },
  );
  router.get(
    "/:id/bytes",
    rnetRoute({
      operationId: "getMediaElementBytes",
      request: { param: RecordIdParamsSchema },
      responses: { 200: binaryResponse("*/*"), 422: ProblemSchema },
    }),
    async (context) => {
      const mediaElementsService = new MediaElementsService({ db, actor: context.get("actor") });
      const mediaElement = await mediaElementsService.getMediaElement(
        context.req.valid("param").id,
      );
      const blob = await blobs.get("elements", mediaElement.contentHash);
      return blobResponse(context, blob);
    },
  );

  return router;
}

async function mediaElementDocument(
  mediaElement: DbMediaElement,
  blobs: BlobStore,
): Promise<MediaElement> {
  return {
    rnet_schema: RNET_SCHEMA_VERSION,
    uri: `rnet://element/${mediaElement.uuid}`,
    owner: `rnet://id/${mediaElement.ownerUuid}`,
    content_hash: mediaElement.contentHash,
    kind: mediaElement.kind,
    mime: mediaElement.mime,
    bytes: await blobs.signedUrl("elements", mediaElement.contentHash),
    byte_size: mediaElement.byteSize,
    created_at: mediaElement.createdAt.toISOString(),
  };
}
