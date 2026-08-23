import { mediaObjectSchema, vibeSchema } from "@rnet/types";
import { Hono } from "hono";

import { Problem } from "../errors.ts";
import type { Services } from "../services/index.ts";
import type {
  CreateMediaObjectsInput,
  SetMediaObjectInferredInput,
  SetMediaObjectUserInput,
} from "../services/media-objects.ts";
import {
  collectionOf,
  defineRoute,
  jsonResponse,
  jsonSchema,
  rnetDocument,
  validateJsonRequest,
} from "./contracts.ts";
import type { AppEnvironment } from "./types.ts";

const mediaObjectDocument = rnetDocument("media-object");
const createMediaObjectsRoute = defineRoute({
  request: {
    json: jsonSchema<CreateMediaObjectsInput>({
      type: "object",
      required: ["objects"],
      properties: {
        vibe: vibeSchema.properties.uri,
        objects: { type: "array", minItems: 1, items: { type: "object" } },
      },
      additionalProperties: false,
    }),
  },
  responses: { 201: collectionOf(mediaObjectDocument) },
});
const getMediaObjectRoute = defineRoute({ responses: { 200: mediaObjectDocument } });
const setMediaObjectUserRoute = defineRoute({
  request: {
    json: jsonSchema<SetMediaObjectUserInput>({
      type: "object",
      required: ["properties"],
      properties: { properties: { type: "object" } },
      additionalProperties: false,
    }),
  },
  responses: { 200: mediaObjectDocument },
});
const setMediaObjectInferredRoute = defineRoute({
  request: {
    json: jsonSchema<SetMediaObjectInferredInput>({
      type: "object",
      required: ["task", "entry"],
      properties: {
        task: { type: "string", minLength: 1 },
        entry: mediaObjectSchema.properties.inferred.additionalProperties,
      },
      additionalProperties: false,
    }),
  },
  responses: { 200: mediaObjectDocument },
});

export function createMediaObjectRoutes(services: Services) {
  const router = new Hono<AppEnvironment>();

  router.post("/", validateJsonRequest(createMediaObjectsRoute), async (context) =>
    jsonResponse(
      context,
      createMediaObjectsRoute,
      201,
      {
        items: await services.mediaObjects.createMediaObjects(
          context.get("actor"),
          context.req.valid("json"),
        ),
      },
    ),
  );
  router.get("/:id", async (context) => {
    const result = await services.mediaObjects.getMediaObject(context.get("actor"), context.req.param("id"));
    context.header("ETag", `"${result.userRev}"`);
    return jsonResponse(context, getMediaObjectRoute, 200, result.document);
  });
  router.patch("/:id/user", validateJsonRequest(setMediaObjectUserRoute), async (context) => {
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
    const result = await services.mediaObjects.setUser(
      context.get("actor"),
      context.req.param("id"),
      expectedRevision,
      context.req.valid("json"),
    );
    context.header("ETag", `"${result.userRev}"`);
    return jsonResponse(context, setMediaObjectUserRoute, 200, result.document);
  });
  router.put("/:id/inferred", validateJsonRequest(setMediaObjectInferredRoute), async (context) =>
    jsonResponse(
      context,
      setMediaObjectInferredRoute,
      200,
      await services.mediaObjects.setInferred(
        context.get("actor"),
        context.req.param("id"),
        context.req.valid("json"),
      ),
    ),
  );

  return router;
}
