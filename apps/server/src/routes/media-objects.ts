import { mediaObjectSchema, vibeSchema } from "@rnet/types";
import { Hono } from "hono";

import type { Database } from "../db/index.ts";
import { Problem } from "../errors.ts";
import { MediaObjectService } from "../services/media-objects.ts";
import {
  collectionOf,
  jsonSchema,
  problemSchema,
  rnetDocument,
  rnetRoute,
} from "./contracts.ts";
import type { AppEnvironment } from "./types.ts";

const mediaObjectDocumentSchema = rnetDocument("media-object");
const mediaObjectCollectionSchema = collectionOf(mediaObjectDocumentSchema);
const createMediaObjectsRequestSchema = jsonSchema({
  type: "object",
  required: ["objects"],
  properties: {
    vibe: vibeSchema.properties.uri,
    objects: { type: "array", minItems: 1, items: { type: "object" } },
  },
  additionalProperties: false,
});
const setMediaObjectUserRequestSchema = jsonSchema({
  type: "object",
  required: ["properties"],
  properties: { properties: { type: "object" } },
  additionalProperties: false,
});
const setMediaObjectInferredRequestSchema = jsonSchema({
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
      request: { json: createMediaObjectsRequestSchema },
      responses: { 201: mediaObjectCollectionSchema, 422: problemSchema },
    }),
    async (context) => {
      const input = context.req.valid("json");
      const mediaObjectService = new MediaObjectService({ db, actor: context.get("actor") });
      return context.json(
        { items: await mediaObjectService.createMediaObjects(input.vibe, input.objects) },
        201,
      );
    },
  );
  router.get(
    "/:id",
    rnetRoute({ responses: { 200: mediaObjectDocumentSchema } }),
    async (context) => {
      const mediaObjectService = new MediaObjectService({ db, actor: context.get("actor") });
      const result = await mediaObjectService.getMediaObject(context.req.param("id"));
      context.header("ETag", `"${result.userRev}"`);
      return context.json(result.document);
    },
  );
  router.patch(
    "/:id/user",
    rnetRoute({
      request: { json: setMediaObjectUserRequestSchema },
      responses: { 200: mediaObjectDocumentSchema, 422: problemSchema },
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
        context.req.param("id"),
        expectedRevision,
        input.properties,
      );
      context.header("ETag", `"${result.userRev}"`);
      return context.json(result.document);
    },
  );
  router.put(
    "/:id/inferred",
    rnetRoute({
      request: { json: setMediaObjectInferredRequestSchema },
      responses: { 200: mediaObjectDocumentSchema, 422: problemSchema },
    }),
    async (context) => {
      const input = context.req.valid("json");
      const mediaObjectService = new MediaObjectService({ db, actor: context.get("actor") });
      return context.json(
        await mediaObjectService.setInferred(context.req.param("id"), input.task, input.entry),
      );
    },
  );

  return router;
}
