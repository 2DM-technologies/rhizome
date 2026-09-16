import { mediaElementSchema, type MediaElement } from "@rnet/types";

import type { BlobStore } from "../blobs/index.ts";
import { ElementThumbnailCache } from "../blobs/element-thumbnails.ts";
import type { Database } from "../db/index.ts";
import { serializeMediaElement } from "../serializers/media-element-serializer.ts";
import { MediaElementsService } from "../services/media-element-service.ts";
import { schemaProblem } from "../services/problems.ts";
import {
  BinaryRequest,
  ProblemSchema,
  RecordIdParamsSchema,
  binaryResponse,
  jsonObjectSchema,
  jsonSchemaValue,
  rnetDocument,
} from "./contracts.ts";
import { blobResponse, mediaElementContentType, requestMime } from "./http.ts";
import { createRhizomeRouter } from "./rhizome-router.ts";

const MediaElementDocumentSchema = rnetDocument("media-element");
const MediaElementMimeSchema = jsonSchemaValue<MediaElement["mime"]>(
  mediaElementSchema.properties.mime,
);
const MediaElementUploadHeadersSchema = jsonObjectSchema(
  {
    "x-rnet-kind": jsonSchemaValue<MediaElement["kind"]>(mediaElementSchema.properties.kind),
  },
  ["x-rnet-kind"] as const,
);

export function createMediaElementRoutes(db: Database, blobs: BlobStore, baseUrl: string) {
  const router = createRhizomeRouter();
  const thumbnails = new ElementThumbnailCache(blobs);

  router.post(
    "/",
    {
      operationId: "createMediaElement",
      auth: "user",
      request: { binary: BinaryRequest, header: MediaElementUploadHeadersSchema },
      responses: {
        201: MediaElementDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        422: ProblemSchema,
      },
    },
    async (context) => {
      const actor = context.get("actor");
      const mediaElementsService = new MediaElementsService({ db, actor, blobs });
      const ownerUuid = actor.uuid;
      const bytes = new Uint8Array(await context.req.arrayBuffer());
      const headers = context.req.valid("header");
      const mime = requestMime(context.req.header("Content-Type"));
      const mimeValidation = MediaElementMimeSchema.validate(mime);
      if (!mimeValidation.ok) throw schemaProblem(mimeValidation.issues, "/content-type");
      const mediaElementRecord = await mediaElementsService.createMediaElement({
        ownerUuid,
        mediaElementUpload: {
          bytes,
          mime,
          kind: headers["x-rnet-kind"],
        },
      });
      const mediaElement = serializeMediaElement(mediaElementRecord, baseUrl);
      return context.json(mediaElement, 201);
    },
  );
  router.get(
    "/:id",
    {
      operationId: "getMediaElement",
      request: { param: RecordIdParamsSchema },
      responses: { 200: MediaElementDocumentSchema, 422: ProblemSchema },
    },
    async (context) => {
      const mediaElementsService = new MediaElementsService({ db, actor: context.get("actor") });
      const mediaElement = await mediaElementsService.getMediaElement(
        context.req.valid("param").id,
      );
      const document = serializeMediaElement(mediaElement, baseUrl);
      return context.json(document);
    },
  );
  router.get(
    "/:id/bytes",
    {
      operationId: "getMediaElementBytes",
      request: { param: RecordIdParamsSchema },
      responses: { 200: binaryResponse("*/*"), 422: ProblemSchema },
    },
    async (context) => {
      const mediaElementsService = new MediaElementsService({ db, actor: context.get("actor") });
      const mediaElement = await mediaElementsService.getMediaElement(
        context.req.valid("param").id,
      );
      const blob = await blobs.get("elements", mediaElement.contentHash);
      return blobResponse(
        context,
        blob,
        mediaElementContentType(mediaElement.kind, mediaElement.mime),
      );
    },
  );
  router.get(
    "/:id/thumbnail",
    {
      operationId: "getMediaElementThumbnail",
      request: { param: RecordIdParamsSchema },
      responses: { 200: binaryResponse("image/webp"), 404: ProblemSchema, 422: ProblemSchema },
    },
    async (context) => {
      const mediaElementsService = new MediaElementsService({ db, actor: context.get("actor") });
      // A shared content-hash cache must never bypass grants or tombstone checks.
      const mediaElement = await mediaElementsService.getMediaElement(
        context.req.valid("param").id,
      );
      return blobResponse(context, await thumbnails.get(mediaElement), "image/webp");
    },
  );
  router.delete(
    "/:id",
    {
      operationId: "deleteMediaElement",
      auth: "user",
      request: { param: RecordIdParamsSchema },
      responses: {
        204: null,
        401: ProblemSchema,
        403: ProblemSchema,
        404: ProblemSchema,
        422: ProblemSchema,
      },
    },
    async (context) => {
      const mediaElementsService = new MediaElementsService({ db, actor: context.get("actor") });
      await mediaElementsService.deleteMediaElement(context.req.valid("param").id);
      return context.body(null, 204);
    },
  );

  return router;
}
