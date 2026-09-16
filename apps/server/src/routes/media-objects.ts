import { validateMediaObjectProperties } from "@rnet/types";
import {
  clientCreateMediaObjectsRequestSchema,
  createMediaObjectsRequestSchema,
  mediaObjectsResponseSchema,
  ownerCreateMediaObjectsRequestSchema,
  setMediaObjectInferredRequestSchema,
  setMediaObjectUserRequestSchema,
  objectInferenceStatusSchema,
  type CreateMediaObjectInput,
} from "@rhizome/store-contract";

import type { BlobStore } from "../blobs/index.ts";
import type { Database } from "../db/index.ts";
import type { PushService } from "../push/push-service.ts";
import type { PendingMediaElementUpload } from "../services/media-element-service.ts";
import { MediaObjectsService } from "../services/media-object-service.ts";
import { schemaProblem } from "../services/problems.ts";
import { serializeMediaObject } from "../serializers/media-object-serializer.ts";
import {
  ProblemSchema,
  RecordIdParamsSchema,
  collectionOf,
  jsonSchema,
  jsonSchemaByActor,
  rnetDocument,
} from "./contracts.ts";
import { requestMime } from "./http.ts";
import { createRhizomeRouter } from "./rhizome-router.ts";

const OwnerCreateMediaObjectsRequestSchema = jsonSchema(ownerCreateMediaObjectsRequestSchema);
const ClientCreateMediaObjectsRequestSchema = jsonSchema(clientCreateMediaObjectsRequestSchema);

export const CreateMediaObjectsRequestSchema = jsonSchemaByActor({
  user: OwnerCreateMediaObjectsRequestSchema,
  client: ClientCreateMediaObjectsRequestSchema,
  document: createMediaObjectsRequestSchema,
});

/**
 * Where a create request carries the properties to validate against the registered type
 * vocabulary, and the JSON pointer to report against. Owners supply `source.properties`;
 * clients supply a bare `properties` and the store authors the surrounding source block.
 * Lives here so the two request shapes are only ever interpreted next to their schemas.
 */
export function mediaObjectPropertiesInput(input: CreateMediaObjectInput): {
  properties: Record<string, unknown>;
  pointer: string;
} {
  if ("source" in input) {
    return { properties: input.source.properties, pointer: "source/properties" };
  }
  return { properties: input.properties ?? {}, pointer: "properties" };
}

const MediaObjectDocumentSchema = rnetDocument("media-object");
const MediaObjectCollectionSchema = collectionOf(
  MediaObjectDocumentSchema,
  "mediaObjects",
  mediaObjectsResponseSchema,
);
const SetMediaObjectUserRequestSchema = jsonSchema(setMediaObjectUserRequestSchema);
const SetMediaObjectInferredRequestSchema = jsonSchema(setMediaObjectInferredRequestSchema);
const ObjectInferenceStatusSchema = jsonSchema(objectInferenceStatusSchema);

export function createMediaObjectRoutes(db: Database, blobs: BlobStore, pushService: PushService) {
  const router = createRhizomeRouter();

  router.get(
    "/:id/inference-status",
    {
      operationId: "getObjectInferenceStatus",
      request: { param: RecordIdParamsSchema },
      responses: {
        200: ObjectInferenceStatusSchema,
        403: ProblemSchema,
        404: ProblemSchema,
        422: ProblemSchema,
      },
    },
    async (context) =>
      context.json(
        await pushService.getObjectInferenceStatus(
          context.req.valid("param").id,
          context.get("actor"),
        ),
      ),
  );

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
        const { properties, pointer } = mediaObjectPropertiesInput(mediaObject);
        const validation = validateMediaObjectProperties(mediaObject.type, properties);
        if (!validation.ok) throw schemaProblem(validation.issues, `/objects/${index}/${pointer}`);
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
      const mediaObjectAggregate = await mediaObjectsService.getMediaObject(
        context.req.valid("param").id,
      );
      const mediaObject = serializeMediaObject(mediaObjectAggregate);
      return context.json(mediaObject);
    },
  );
  router.patch(
    "/:id/user",
    {
      operationId: "setMediaObjectUser",
      auth: "user_or_client",
      request: {
        param: RecordIdParamsSchema,
        json: SetMediaObjectUserRequestSchema,
      },
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
      const mediaObjectAggregate = await mediaObjectsService.setUser(
        context.req.valid("param").id,
        input.properties,
      );
      const mediaObject = serializeMediaObject(mediaObjectAggregate);
      return context.json(mediaObject);
    },
  );
  router.put(
    "/:id/inferred",
    {
      operationId: "setMediaObjectInferred",
      auth: "client",
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
