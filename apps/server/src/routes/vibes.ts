import { vibeSchema } from "@rnet/types";
import { Hono } from "hono";

import type { Database } from "../db/index.ts";
import { Problem } from "../errors.ts";
import { AccessService } from "../services/access.ts";
import { VibeService } from "../services/vibes.ts";
import {
  collectionOf,
  jsonSchema,
  problemSchema,
  rnetDocument,
  rnetRoute,
} from "./contracts.ts";
import type { AppEnvironment } from "./types.ts";

const vibeDocumentSchema = rnetDocument("vibe");
const vibeCollectionSchema = collectionOf(vibeDocumentSchema);
const mediaObjectCollectionSchema = collectionOf(rnetDocument("media-object"));
const createVibeRequestSchema = jsonSchema({
  type: "object",
  required: ["title"],
  properties: {
    title: vibeSchema.properties.title,
    pull: vibeSchema.properties.pull,
    grants: vibeSchema.properties.grants,
  },
  additionalProperties: false,
});
const updateVibeRequestSchema = jsonSchema({
  type: "object",
  properties: {
    title: vibeSchema.properties.title,
    pull: vibeSchema.properties.pull,
    grants: vibeSchema.properties.grants,
  },
  additionalProperties: false,
});
const mediaObjectRefsSchema = jsonSchema({
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

  router.get("/", rnetRoute({ responses: { 200: vibeCollectionSchema } }), async (context) => {
    const vibeService = new VibeService({ db, actor: context.get("actor") });
    return context.json({ items: await vibeService.listVibes() });
  });
  router.post(
    "/",
    rnetRoute({
      request: { json: createVibeRequestSchema },
      responses: { 201: vibeDocumentSchema, 422: problemSchema },
    }),
    async (context) => {
      const vibeService = new VibeService({ db, actor: context.get("actor") });
      return context.json(await vibeService.createVibe(context.req.valid("json")), 201);
    },
  );
  router.get(
    "/:id",
    rnetRoute({ responses: { 200: vibeDocumentSchema } }),
    async (context) => {
      const vibeService = new VibeService({ db, actor: context.get("actor") });
      return context.json(await vibeService.getVibe(context.req.param("id")));
    },
  );
  router.patch(
    "/:id",
    rnetRoute({
      request: { json: updateVibeRequestSchema },
      responses: { 200: vibeDocumentSchema, 422: problemSchema },
    }),
    async (context) => {
      const vibeService = new VibeService({ db, actor: context.get("actor") });
      return context.json(
        await vibeService.updateVibe(context.req.param("id"), context.req.valid("json")),
      );
    },
  );
  router.delete("/:id", async (context) => {
    const vibeService = new VibeService({ db, actor: context.get("actor") });
    await vibeService.deleteVibe(context.req.param("id"));
    return context.body(null, 204);
  });
  router.get(
    "/:id/objects",
    rnetRoute({ responses: { 200: mediaObjectCollectionSchema } }),
    async (context) => {
      const vibeService = new VibeService({ db, actor: context.get("actor") });
      return context.json({ items: await vibeService.listMediaObjects(context.req.param("id")) });
    },
  );
  router.post(
    "/:id/objects",
    rnetRoute({
      request: { json: mediaObjectRefsSchema },
      responses: { 422: problemSchema },
    }),
    async (context) => {
      const body = context.req.valid("json");
      const vibeService = new VibeService({ db, actor: context.get("actor") });
      await vibeService.addMediaObjectRefs(context.req.param("id"), body.objects);
      return context.body(null, 204);
    },
  );
  router.delete(
    "/:id/objects",
    rnetRoute({
      request: { json: mediaObjectRefsSchema },
      responses: { 422: problemSchema },
    }),
    async (context) => {
      const body = context.req.valid("json");
      const vibeService = new VibeService({ db, actor: context.get("actor") });
      await vibeService.removeMediaObjectRefs(context.req.param("id"), body.objects);
      return context.body(null, 204);
    },
  );
  router.post("/:id/push", async (context) => {
    const accessService = new AccessService({ db, actor: context.get("actor") });
    await accessService.assertVibeScope(context.req.param("id"), "push");
    throw new Problem(
      501,
      "not_implemented",
      "Push is scheduled for M3",
      "The operation record exists in M1; model execution lands in M3",
    );
  });
  router.post("/:id/pull", async (context) => {
    const accessService = new AccessService({ db, actor: context.get("actor") });
    await accessService.assertVibeScope(context.req.param("id"), "pull");
    throw new Problem(501, "not_implemented", "Pull is scheduled for M2", "Compiled ingestion lands in M2");
  });

  return router;
}
