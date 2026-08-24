import { mediaElementSchema, mediaObjectSchema, vibeSchema } from "@rnet/types";
import { Hono } from "hono";

import type { BlobStore } from "../blobs/index.ts";
import type { Database } from "../db/index.ts";
import { Problem } from "../errors.ts";
import type { PendingMediaElementUpload } from "../services/media-element-service.ts";
import { MediaObjectService } from "../services/media-object-service.ts";
import {
  ProblemSchema,
  RecordIdParamsSchema,
  collectionOf,
  jsonSchema,
  rnetDocument,
  rnetRoute,
} from "./contracts.ts";
import { requestMime } from "./http.ts";
import type { AppEnvironment } from "./types.ts";

const MediaObjectDocumentSchema = rnetDocument("media-object");
const MediaObjectCollectionSchema = collectionOf(MediaObjectDocumentSchema, "mediaObjects");
const MediaElementUploadReferenceSchema = {
  type: "object",
  required: ["upload", "kind", "mime"],
  properties: {
    upload: { type: "string", minLength: 1 },
    kind: mediaElementSchema.properties.kind,
    mime: mediaElementSchema.properties.mime,
  },
  additionalProperties: false,
} as const;
const CreateMediaObjectsRequestSchema = jsonSchema({
  type: "object",
  required: ["objects"],
  properties: {
    vibe: vibeSchema.properties.uri,
    objects: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          elements: {
            type: "array",
            items: {
              anyOf: [
                mediaObjectSchema.properties.elements.items,
                MediaElementUploadReferenceSchema,
              ],
            },
          },
        },
      },
    },
  },
  additionalProperties: false,
});
const SetMediaObjectUserRequestSchema = jsonSchema({
  type: "object",
  required: ["properties"],
  properties: { properties: { type: "object" } },
  additionalProperties: false,
});
const SetMediaObjectInferredRequestSchema = jsonSchema({
  type: "object",
  required: ["task", "entry"],
  properties: {
    task: { type: "string", minLength: 1 },
    entry: mediaObjectSchema.properties.inferred.additionalProperties,
  },
  additionalProperties: false,
});

export function createMediaObjectRoutes(db: Database, blobs: BlobStore) {
  const router = new Hono<AppEnvironment>();

  router.post(
    "/",
    rnetRoute({
      operationId: "createMediaObjects",
      auth: "user_or_client",
      request: { multipart: CreateMediaObjectsRequestSchema },
      responses: {
        201: MediaObjectCollectionSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        415: ProblemSchema,
        422: ProblemSchema,
      },
    }),
    async (context) => {
      const input = context.req.valid("form");
      const pendingUploads = new Map<string, PendingMediaElementUpload>();
      for (const [name, file] of input.uploads) {
        pendingUploads.set(name, {
          bytes: new Uint8Array(await file.arrayBuffer()),
          ...(file.type ? { mime: requestMime(file.type) } : {}),
        });
      }
      const mediaObjectService = new MediaObjectService({
        db,
        actor: context.get("actor"),
        blobs,
      });
      const mediaObjects = await mediaObjectService.createMediaObjects(
        input.metadata.vibe,
        input.metadata.objects,
        pendingUploads,
      );
      return context.json({ mediaObjects }, 201);
    },
  );
  router.get(
    "/:id",
    rnetRoute({
      operationId: "getMediaObject",
      request: { param: RecordIdParamsSchema },
      responses: { 200: MediaObjectDocumentSchema, 422: ProblemSchema },
    }),
    async (context) => {
      const mediaObjectService = new MediaObjectService({ db, actor: context.get("actor") });
      const result = await mediaObjectService.getMediaObject(context.req.valid("param").id);
      const mediaObject = result.document;
      context.header("ETag", `"${result.userRev}"`);
      return context.json(mediaObject);
    },
  );
  router.patch(
    "/:id/user",
    rnetRoute({
      operationId: "setMediaObjectUser",
      request: { param: RecordIdParamsSchema, json: SetMediaObjectUserRequestSchema },
      responses: { 200: MediaObjectDocumentSchema, 422: ProblemSchema },
    }),
    async (context) => {
      const header = context.req.header("If-Match");
      if (header === undefined) {
        throw new Problem(409, "revision_conflict", "Revision required", "If-Match is required");
      }
      const expectedRevision = Number(header.replaceAll('"', ""));
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
        throw new Problem(
          409,
          "revision_conflict",
          "Invalid revision",
          "If-Match must be an integer revision",
        );
      }
      const input = context.req.valid("json");
      const mediaObjectService = new MediaObjectService({ db, actor: context.get("actor") });
      const result = await mediaObjectService.setUser(
        context.req.valid("param").id,
        expectedRevision,
        input.properties,
      );
      const mediaObject = result.document;
      context.header("ETag", `"${result.userRev}"`);
      return context.json(mediaObject);
    },
  );
  router.put(
    "/:id/inferred",
    rnetRoute({
      operationId: "setMediaObjectInferred",
      request: { param: RecordIdParamsSchema, json: SetMediaObjectInferredRequestSchema },
      responses: { 200: MediaObjectDocumentSchema, 422: ProblemSchema },
    }),
    async (context) => {
      const input = context.req.valid("json");
      const mediaObjectService = new MediaObjectService({ db, actor: context.get("actor") });
      const mediaObject = await mediaObjectService.setInferred(
        context.req.valid("param").id,
        input.task,
        input.entry,
      );
      return context.json(mediaObject);
    },
  );

  return router;
}
