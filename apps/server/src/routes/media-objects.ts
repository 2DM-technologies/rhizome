import { mediaObjectSchema, validateMediaObjectProperties } from "@rnet/types";

import type { BlobStore } from "../blobs/index.ts";
import type { Database } from "../db/index.ts";
import { Problem } from "../errors.ts";
import type { PendingMediaElementUpload } from "../services/media-element-service.ts";
import { MediaObjectsService } from "../services/media-object-service.ts";
import { schemaProblem } from "../services/problems.ts";
import { serializeMediaObject } from "../serializers/media-object-serializer.ts";
import {
  ProblemSchema,
  RecordIdParamsSchema,
  collectionOf,
  jsonSchema,
  rnetDocument,
} from "./contracts.ts";
import { requestMime } from "./http.ts";
import { CreateMediaObjectsRequestSchema } from "./media-object-contracts.ts";
import { createRnetRouter } from "./rnet-router.ts";

const MediaObjectDocumentSchema = rnetDocument("media-object");
const MediaObjectCollectionSchema = collectionOf(MediaObjectDocumentSchema, "mediaObjects");
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
  const router = createRnetRouter();

  router.post(
    "/",
    {
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
    },
    async (context) => {
      const input = context.req.valid("form");
      for (const [index, mediaObject] of input.metadata.objects.entries()) {
        let properties = "properties" in mediaObject ? (mediaObject.properties ?? {}) : {};
        let propertiesPath = `/objects/${index}/properties`;
        if ("source" in mediaObject) {
          properties = mediaObject.source.properties;
          propertiesPath = `/objects/${index}/source/properties`;
        }
        const validation = validateMediaObjectProperties(mediaObject.type, properties);
        if (!validation.ok) throw schemaProblem(validation.issues, propertiesPath);
      }
      const pendingMediaElementUploads = new Map<string, PendingMediaElementUpload>();
      for (const [name, file] of input.uploads) {
        pendingMediaElementUploads.set(name, {
          bytes: new Uint8Array(await file.arrayBuffer()),
          ...(file.type ? { mime: requestMime(file.type) } : {}),
        });
      }
      const mediaObjectsService = new MediaObjectsService({
        db,
        actor: context.get("actor"),
        blobs,
      });
      const mediaObjectAggregates = await mediaObjectsService.createMediaObjects(
        input.metadata.vibe,
        input.metadata.objects,
        pendingMediaElementUploads,
      );
      const mediaObjects = mediaObjectAggregates.map(serializeMediaObject);
      return context.json({ mediaObjects }, 201);
    },
  );
  router.get(
    "/:id",
    {
      operationId: "getMediaObject",
      request: { param: RecordIdParamsSchema },
      responses: { 200: MediaObjectDocumentSchema, 422: ProblemSchema },
    },
    async (context) => {
      const mediaObjectsService = new MediaObjectsService({ db, actor: context.get("actor") });
      const result = await mediaObjectsService.getMediaObject(context.req.valid("param").id);
      const mediaObject = serializeMediaObject(result.mediaObject);
      context.header("ETag", `"${result.userRev}"`);
      return context.json(mediaObject);
    },
  );
  router.patch(
    "/:id/user",
    {
      operationId: "setMediaObjectUser",
      auth: "user_or_client",
      request: { param: RecordIdParamsSchema, json: SetMediaObjectUserRequestSchema },
      responses: {
        200: MediaObjectDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        409: ProblemSchema,
        422: ProblemSchema,
      },
    },
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
      const mediaObjectsService = new MediaObjectsService({ db, actor: context.get("actor") });
      const result = await mediaObjectsService.setUser(
        context.req.valid("param").id,
        expectedRevision,
        input.properties,
      );
      const mediaObject = serializeMediaObject(result.mediaObject);
      context.header("ETag", `"${result.userRev}"`);
      return context.json(mediaObject);
    },
  );
  router.put(
    "/:id/inferred",
    {
      operationId: "setMediaObjectInferred",
      auth: "user_or_client",
      request: { param: RecordIdParamsSchema, json: SetMediaObjectInferredRequestSchema },
      responses: {
        200: MediaObjectDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        422: ProblemSchema,
      },
    },
    async (context) => {
      const input = context.req.valid("json");
      const mediaObjectsService = new MediaObjectsService({ db, actor: context.get("actor") });
      const mediaObjectAggregate = await mediaObjectsService.setInferred(
        context.req.valid("param").id,
        input.task,
        input.entry,
      );
      const mediaObject = serializeMediaObject(mediaObjectAggregate);
      return context.json(mediaObject);
    },
  );

  return router;
}
