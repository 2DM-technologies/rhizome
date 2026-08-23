import { Hono } from "hono";

import { Problem } from "../errors.ts";
import type { Services } from "../services/index.ts";
import { jsonBody } from "./http.ts";
import type { AppEnvironment } from "./types.ts";

export function createMediaObjectRoutes(services: Services) {
  const router = new Hono<AppEnvironment>();

  router.post("/", async (context) =>
    context.json(
      {
        items: await services.mediaObjects.createMediaObjects(
          context.get("actor"),
          await jsonBody(context),
        ),
      },
      201,
    ),
  );
  router.get("/:id", async (context) => {
    const result = await services.mediaObjects.getMediaObject(context.get("actor"), context.req.param("id"));
    context.header("ETag", `"${result.userRev}"`);
    return context.json(result.document);
  });
  router.patch("/:id/user", async (context) => {
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
      await jsonBody(context),
    );
    context.header("ETag", `"${result.userRev}"`);
    return context.json(result.document);
  });
  router.put("/:id/inferred", async (context) =>
    context.json(
      await services.mediaObjects.setInferred(
        context.get("actor"),
        context.req.param("id"),
        await jsonBody(context),
      ),
    ),
  );

  return router;
}
