import { vibeSchema } from "@rnet/types";
import { Hono } from "hono";

import type { Database } from "../db/index.ts";
import { Problem } from "../errors.ts";
import { AccessService } from "../services/access.ts";
import { VibeService } from "../services/vibes.ts";
import {
  ProblemSchema,
  RecordIdParamsSchema,
  collectionOf,
  jsonSchema,
  rnetDocument,
  rnetRoute,
} from "./contracts.ts";
import type { AppEnvironment } from "./types.ts";

const VibeDocumentSchema = rnetDocument("vibe");
const VibeCollectionSchema = collectionOf(VibeDocumentSchema, "vibes");
const MediaObjectCollectionSchema = collectionOf(rnetDocument("media-object"), "mediaObjects");
const CreateVibeRequestSchema = jsonSchema({
  type: "object",
  required: ["title"],
  properties: {
    title: vibeSchema.properties.title,
    pull: vibeSchema.properties.pull,
    grants: vibeSchema.properties.grants,
  },
  additionalProperties: false,
});
const UpdateVibeRequestSchema = jsonSchema({
  type: "object",
  properties: {
    title: vibeSchema.properties.title,
    pull: vibeSchema.properties.pull,
    grants: vibeSchema.properties.grants,
  },
  additionalProperties: false,
});
const MediaObjectRefsSchema = jsonSchema({
  type: "object",
  required: ["objects"],
  properties: {
    objects: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: vibeSchema.properties.objects.items,
    },
  },
  additionalProperties: false,
});
export function createVibeRoutes(db: Database) {
  const router = new Hono<AppEnvironment>();

  router.get("/", rnetRoute({ responses: { 200: VibeCollectionSchema } }), async (context) => {
    const vibeService = new VibeService({ db, actor: context.get("actor") });
    const vibes = await vibeService.listVibes();
    return context.json({ vibes });
  });
  router.post(
    "/",
    rnetRoute({
      auth: "user",
      request: { json: CreateVibeRequestSchema },
      responses: {
        201: VibeDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        422: ProblemSchema,
      },
    }),
    async (context) => {
      const vibeService = new VibeService({ db, actor: context.get("actor") });
      const vibe = await vibeService.createVibe(context.req.valid("json"));
      return context.json(vibe, 201);
    },
  );
  router.get(
    "/:id",
    rnetRoute({
      request: { param: RecordIdParamsSchema },
      responses: { 200: VibeDocumentSchema, 422: ProblemSchema },
    }),
    async (context) => {
      const vibeService = new VibeService({ db, actor: context.get("actor") });
      const vibe = await vibeService.getVibe(context.req.valid("param").id);
      return context.json(vibe);
    },
  );
  router.patch(
    "/:id",
    rnetRoute({
      request: { param: RecordIdParamsSchema, json: UpdateVibeRequestSchema },
      responses: { 200: VibeDocumentSchema, 422: ProblemSchema },
    }),
    async (context) => {
      const vibeService = new VibeService({ db, actor: context.get("actor") });
      const vibe = await vibeService.updateVibe(
        context.req.valid("param").id,
        context.req.valid("json"),
      );
      return context.json(vibe);
    },
  );
  router.delete(
    "/:id",
    rnetRoute({
      request: { param: RecordIdParamsSchema },
      responses: { 422: ProblemSchema },
    }),
    async (context) => {
      const vibeService = new VibeService({ db, actor: context.get("actor") });
      await vibeService.deleteVibe(context.req.valid("param").id);
      return context.body(null, 204);
    },
  );
  router.get(
    "/:id/objects",
    rnetRoute({
      request: { param: RecordIdParamsSchema },
      responses: { 200: MediaObjectCollectionSchema, 422: ProblemSchema },
    }),
    async (context) => {
      const vibeService = new VibeService({ db, actor: context.get("actor") });
      const mediaObjects = await vibeService.listMediaObjects(context.req.valid("param").id);
      return context.json({ mediaObjects });
    },
  );
  router.post(
    "/:id/objects",
    rnetRoute({
      request: { param: RecordIdParamsSchema, json: MediaObjectRefsSchema },
      responses: { 422: ProblemSchema },
    }),
    async (context) => {
      const body = context.req.valid("json");
      const vibeService = new VibeService({ db, actor: context.get("actor") });
      await vibeService.addMediaObjectRefs(context.req.valid("param").id, body.objects);
      return context.body(null, 204);
    },
  );
  router.delete(
    "/:id/objects",
    rnetRoute({
      request: { param: RecordIdParamsSchema, json: MediaObjectRefsSchema },
      responses: { 422: ProblemSchema },
    }),
    async (context) => {
      const body = context.req.valid("json");
      const vibeService = new VibeService({ db, actor: context.get("actor") });
      await vibeService.removeMediaObjectRefs(context.req.valid("param").id, body.objects);
      return context.body(null, 204);
    },
  );
  router.post(
    "/:id/push",
    rnetRoute({
      request: { param: RecordIdParamsSchema },
      responses: { 422: ProblemSchema },
    }),
    async (context) => {
      const accessService = new AccessService({ db, actor: context.get("actor") });
      await accessService.assertVibeScope(context.req.valid("param").id, "push");
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
    rnetRoute({
      request: { param: RecordIdParamsSchema },
      responses: { 422: ProblemSchema },
    }),
    async (context) => {
      const accessService = new AccessService({ db, actor: context.get("actor") });
      await accessService.assertVibeScope(context.req.valid("param").id, "pull");
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
