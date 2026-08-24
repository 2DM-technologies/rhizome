import { mediaElementSchema, type MediaElement } from "@rnet/types";
import { Hono } from "hono";

import type { BlobStore } from "../blobs/index.ts";
import type { Database } from "../db/index.ts";
import { serializeMediaElement } from "../serializers/media-element-serializer.ts";
import { MediaElementsService } from "../services/media-element-service.ts";
import {
  BinaryRequest,
  ProblemSchema,
  RecordIdParamsSchema,
  binaryResponse,
  jsonObjectSchema,
  jsonSchemaValue,
  rnetDocument,
  rnetRoute,
  transformSchema,
} from "./contracts.ts";
import { blobResponse, requestMime } from "./http.ts";
import type { AppEnvironment } from "./types.ts";

const MediaElementDocumentSchema = rnetDocument("media-element");
const MediaElementUploadHeadersSchema = transformSchema(
  jsonObjectSchema(
    {
      "content-type": jsonSchemaValue<MediaElement["mime"]>(mediaElementSchema.properties.mime),
      "x-rnet-kind": jsonSchemaValue<MediaElement["kind"]>(mediaElementSchema.properties.kind),
    },
    ["content-type", "x-rnet-kind"] as const,
  ),
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const headers = value as Record<string, unknown>;
    return {
      ...headers,
      "content-type": requestMime(
        typeof headers["content-type"] === "string" ? headers["content-type"] : undefined,
      ),
    };
  },
);

export function createMediaElementRoutes(db: Database, blobs: BlobStore) {
  const router = new Hono<AppEnvironment>();

  router.post(
    "/",
    rnetRoute({
      operationId: "createMediaElement",
      auth: "user",
      request: { binary: BinaryRequest, header: MediaElementUploadHeadersSchema },
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
      const headers = context.req.valid("header");
      const mediaElementRecord = await mediaElementsService.createMediaElement({
        ownerUuid,
        mediaElementUpload: {
          bytes,
          mime: headers["content-type"],
          kind: headers["x-rnet-kind"],
        },
      });
      const mediaElement = await serializeMediaElement(mediaElementRecord, blobs);
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
      const document = await serializeMediaElement(mediaElement, blobs);
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
