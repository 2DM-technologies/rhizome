import { vibeSchema } from "@rnet/types";

import type { Database } from "../db/index.ts";
import { GRANT_SCOPE } from "../db/models/grant.ts";
import { Problem } from "../errors.ts";
import { AccessService } from "../services/access-service.ts";
import { VibesService } from "../services/vibe-service.ts";
import { serializeMediaObject } from "../serializers/media-object-serializer.ts";
import { serializeVibe } from "../serializers/vibe-serializer.ts";
import {
  ProblemSchema,
  RecordIdParamsSchema,
  collectionOf,
  jsonSchema,
  rnetDocument,
  type ContractValue,
} from "./contracts.ts";
import { createRhizomeRouter } from "./rhizome-router.ts";

const VibeWritableProperties = {
  title: vibeSchema.properties.title,
  pull: vibeSchema.properties.pull,
  grants: vibeSchema.properties.grants,
} as const;

export const CreateVibeRequestSchema = jsonSchema({
  type: "object",
  required: ["title"],
  properties: VibeWritableProperties,
  additionalProperties: false,
});

export const UpdateVibeRequestSchema = jsonSchema({
  type: "object",
  properties: VibeWritableProperties,
  additionalProperties: false,
});

export const MediaObjectRefsRequestSchema = jsonSchema({
  type: "object",
  required: ["objects"],
  properties: {
    objects: {
      type: "array",
      minItems: 1,
      items: vibeSchema.properties.objects.items,
    },
  },
  additionalProperties: false,
});

export type CreateVibeRequest = ContractValue<typeof CreateVibeRequestSchema>;
export type UpdateVibeRequest = ContractValue<typeof UpdateVibeRequestSchema>;
export type MediaObjectRefsRequest = ContractValue<typeof MediaObjectRefsRequestSchema>;

const VibeDocumentSchema = rnetDocument("vibe");
const VibeCollectionSchema = collectionOf(VibeDocumentSchema, "vibes");
const MediaObjectCollectionSchema = collectionOf(rnetDocument("media-object"), "mediaObjects");
export function createVibeRoutes(db: Database) {
  const router = createRhizomeRouter();

  router.get(
    "/",
    { operationId: "listVibes", responses: { 200: VibeCollectionSchema } },
    async (context) => {
      const vibesService = new VibesService({ db, actor: context.get("actor") });
      const vibeAggregates = await vibesService.listVibes();
      const vibes = vibeAggregates.map(serializeVibe);
      return context.json({ vibes });
    },
  );
  router.post(
    "/",
    {
      operationId: "createVibe",
      auth: "user",
      request: { json: CreateVibeRequestSchema },
      responses: {
        201: VibeDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        422: ProblemSchema,
      },
    },
    async (context) => {
      const vibesService = new VibesService({ db, actor: context.get("actor") });
      const vibeAggregate = await vibesService.createVibe(context.req.valid("json"));
      const vibe = serializeVibe(vibeAggregate);
      return context.json(vibe, 201);
    },
  );
  router.get(
    "/:id",
    {
      operationId: "getVibe",
      request: { param: RecordIdParamsSchema },
      responses: { 200: VibeDocumentSchema, 422: ProblemSchema },
    },
    async (context) => {
      const vibesService = new VibesService({ db, actor: context.get("actor") });
      const vibeAggregate = await vibesService.getVibe(context.req.valid("param").id);
      const vibe = serializeVibe(vibeAggregate);
      return context.json(vibe);
    },
  );
  router.patch(
    "/:id",
    {
      operationId: "updateVibe",
      auth: "user",
      request: { param: RecordIdParamsSchema, json: UpdateVibeRequestSchema },
      responses: {
        200: VibeDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        422: ProblemSchema,
      },
    },
    async (context) => {
      const vibesService = new VibesService({ db, actor: context.get("actor") });
      const vibeAggregate = await vibesService.updateVibe(
        context.req.valid("param").id,
        context.req.valid("json"),
      );
      const vibe = serializeVibe(vibeAggregate);
      return context.json(vibe);
    },
  );
  router.delete(
    "/:id",
    {
      operationId: "deleteVibe",
      auth: "user",
      request: { param: RecordIdParamsSchema },
      responses: { 204: null, 401: ProblemSchema, 403: ProblemSchema, 422: ProblemSchema },
    },
    async (context) => {
      const vibesService = new VibesService({ db, actor: context.get("actor") });
      await vibesService.deleteVibe(context.req.valid("param").id);
      return context.body(null, 204);
    },
  );
  router.get(
    "/:id/objects",
    {
      operationId: "listVibeMediaObjects",
      request: { param: RecordIdParamsSchema },
      responses: { 200: MediaObjectCollectionSchema, 422: ProblemSchema },
    },
    async (context) => {
      const vibesService = new VibesService({ db, actor: context.get("actor") });
      const mediaObjectAggregates = await vibesService.listMediaObjects(
        context.req.valid("param").id,
      );
      const mediaObjects = mediaObjectAggregates.map(serializeMediaObject);
      return context.json({ mediaObjects });
    },
  );
  router.post(
    "/:id/objects",
    {
      operationId: "addVibeMediaObjects",
      auth: "user",
      request: { param: RecordIdParamsSchema, json: MediaObjectRefsRequestSchema },
      responses: { 204: null, 401: ProblemSchema, 403: ProblemSchema, 422: ProblemSchema },
    },
    async (context) => {
      const body = context.req.valid("json");
      const vibesService = new VibesService({ db, actor: context.get("actor") });
      await vibesService.addMediaObjectRefs(context.req.valid("param").id, body.objects);
      return context.body(null, 204);
    },
  );
  router.delete(
    "/:id/objects",
    {
      operationId: "removeVibeMediaObjects",
      auth: "user",
      request: { param: RecordIdParamsSchema, json: MediaObjectRefsRequestSchema },
      responses: { 204: null, 401: ProblemSchema, 403: ProblemSchema, 422: ProblemSchema },
    },
    async (context) => {
      const body = context.req.valid("json");
      const vibesService = new VibesService({ db, actor: context.get("actor") });
      await vibesService.removeMediaObjectRefs(context.req.valid("param").id, body.objects);
      return context.body(null, 204);
    },
  );
  router.post(
    "/:id/push",
    {
      operationId: "pushVibe",
      auth: "user_or_client",
      request: { param: RecordIdParamsSchema },
      responses: {
        401: ProblemSchema,
        403: ProblemSchema,
        422: ProblemSchema,
        501: ProblemSchema,
      },
    },
    async (context) => {
      const accessService = new AccessService({ db, actor: context.get("actor") });
      await accessService.assertVibeScope(context.req.valid("param").id, GRANT_SCOPE.PUSH);
      throw new Problem(
        501,
        "not_implemented",
        "Push is scheduled for M3",
        "The operation record exists in M1; model execution lands in M3",
      );
    },
  );
  router.post(
    "/:id/pull",
    {
      operationId: "pullVibe",
      auth: "user_or_client",
      request: { param: RecordIdParamsSchema },
      responses: {
        401: ProblemSchema,
        403: ProblemSchema,
        422: ProblemSchema,
        501: ProblemSchema,
      },
    },
    async (context) => {
      const accessService = new AccessService({ db, actor: context.get("actor") });
      await accessService.assertVibeScope(context.req.valid("param").id, GRANT_SCOPE.PULL);
      throw new Problem(
        501,
        "not_implemented",
        "Pull is scheduled for M2",
        "Compiled ingestion lands in M2",
      );
    },
  );

  return router;
}
