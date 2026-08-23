import { mediaObjectSchema, vibeSchema } from "@rnet/types";
import { Hono } from "hono";

import type { Database } from "../db/index.ts";
import { Problem } from "../errors.ts";
import { MediaObjectService } from "../services/media-objects.ts";
import {
  ProblemSchema,
  RecordIdParamsSchema,
  collectionOf,
  jsonSchema,
  rnetDocument,
  rnetRoute,
} from "./contracts.ts";
import type { AppEnvironment } from "./types.ts";

const MediaObjectDocumentSchema = rnetDocument("media-object");
const MediaObjectCollectionSchema = collectionOf(MediaObjectDocumentSchema, "mediaObjects");
const CreateMediaObjectsRequestSchema = jsonSchema({
  type: "object",
  required: ["objects"],
  properties: {
    vibe: vibeSchema.properties.uri,
    objects: { type: "array", minItems: 1, items: { type: "object" } },
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

export function createMediaObjectRoutes(db: Database) {
  const router = new Hono<AppEnvironment>();

  router.post(
    "/",
    rnetRoute({
      auth: "authenticated",
      request: { json: CreateMediaObjectsRequestSchema },
      responses: { 201: MediaObjectCollectionSchema, 401: ProblemSchema, 422: ProblemSchema },
    }),
    async (context) => {
      const input = context.req.valid("json");
      const mediaObjectService = new MediaObjectService({ db, actor: context.get("actor") });
      const mediaObjects = await mediaObjectService.createMediaObjects(input.vibe, input.objects);
      return context.json({ mediaObjects }, 201);
    },
  );
  router.get(
    "/:id",
    rnetRoute({
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
