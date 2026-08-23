import { vibeSchema } from "@rnet/types";
import { Hono } from "hono";

import { Problem } from "../errors.ts";
import type { Services } from "../services/index.ts";
import type { CreateVibeInput, UpdateVibeInput } from "../services/vibes.ts";
import {
  collectionOf,
  defineRoute,
  jsonResponse,
  jsonSchema,
  rnetDocument,
  validateJsonRequest,
} from "./contracts.ts";
import type { AppEnvironment } from "./types.ts";

interface MediaObjectRefsInput {
  objects: string[];
}

const vibeDocument = rnetDocument("vibe");
const listVibesRoute = defineRoute({ responses: { 200: collectionOf(vibeDocument) } });
const createVibeRoute = defineRoute({
  request: {
    json: jsonSchema<CreateVibeInput>({
      type: "object",
      required: ["title"],
      properties: {
        title: vibeSchema.properties.title,
        pull: vibeSchema.properties.pull,
        grants: vibeSchema.properties.grants,
      },
      additionalProperties: false,
    }),
  },
  responses: { 201: vibeDocument },
});
const getVibeRoute = defineRoute({ responses: { 200: vibeDocument } });
const updateVibeRoute = defineRoute({
  request: {
    json: jsonSchema<UpdateVibeInput>({
      type: "object",
      properties: {
        title: vibeSchema.properties.title,
        pull: vibeSchema.properties.pull,
        grants: vibeSchema.properties.grants,
      },
      additionalProperties: false,
    }),
  },
  responses: { 200: vibeDocument },
});
const listMediaObjectsRoute = defineRoute({
  responses: { 200: collectionOf(rnetDocument("media-object")) },
});
const mediaObjectRefsSchema = jsonSchema<MediaObjectRefsInput>({
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
const addMediaObjectRefsRoute = defineRoute({
  request: { json: mediaObjectRefsSchema },
  responses: {},
});
const removeMediaObjectRefsRoute = defineRoute({
  request: { json: mediaObjectRefsSchema },
  responses: {},
});

export function createVibeRoutes(services: Services) {
  const router = new Hono<AppEnvironment>();

  router.get("/", async (context) =>
    jsonResponse(context, listVibesRoute, 200, {
      items: await services.vibes.listVibes(context.get("actor")),
    }),
  );
  router.post("/", validateJsonRequest(createVibeRoute), async (context) =>
    jsonResponse(
      context,
      createVibeRoute,
      201,
      await services.vibes.createVibe(context.get("actor"), context.req.valid("json")),
    ),
  );
  router.get("/:id", async (context) =>
    jsonResponse(
      context,
      getVibeRoute,
      200,
      await services.vibes.getVibe(context.get("actor"), context.req.param("id")),
    ),
  );
  router.patch("/:id", validateJsonRequest(updateVibeRoute), async (context) =>
    jsonResponse(
      context,
      updateVibeRoute,
      200,
      await services.vibes.updateVibe(
        context.get("actor"),
        context.req.param("id"),
        context.req.valid("json"),
      ),
    ),
  );
  router.delete("/:id", async (context) => {
    await services.vibes.deleteVibe(context.get("actor"), context.req.param("id"));
    return context.body(null, 204);
  });
  router.get("/:id/objects", async (context) =>
    jsonResponse(context, listMediaObjectsRoute, 200, {
      items: await services.vibes.listMediaObjects(context.get("actor"), context.req.param("id")),
    }),
  );
  router.post("/:id/objects", validateJsonRequest(addMediaObjectRefsRoute), async (context) => {
    const body = context.req.valid("json");
    await services.vibes.addMediaObjectRefs(context.get("actor"), context.req.param("id"), body.objects);
    return context.body(null, 204);
  });
  router.delete("/:id/objects", validateJsonRequest(removeMediaObjectRefsRoute), async (context) => {
    const body = context.req.valid("json");
    await services.vibes.removeMediaObjectRefs(context.get("actor"), context.req.param("id"), body.objects);
    return context.body(null, 204);
  });
  router.post("/:id/push", async (context) => {
    await services.access.assertVibeScope(context.get("actor"), context.req.param("id"), "push");
    throw new Problem(
      501,
      "not_implemented",
      "Push is scheduled for M3",
      "The operation record exists in M1; model execution lands in M3",
    );
  });
  router.post("/:id/pull", async (context) => {
    await services.access.assertVibeScope(context.get("actor"), context.req.param("id"), "pull");
    throw new Problem(501, "not_implemented", "Pull is scheduled for M2", "Compiled ingestion lands in M2");
  });

  return router;
}
