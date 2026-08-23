import { Hono } from "hono";

import { Problem } from "../errors.ts";
import type { Services } from "../services/index.ts";
import { jsonBody } from "./http.ts";
import type { AppEnvironment } from "./types.ts";

export function createVibeRoutes(services: Services) {
  const router = new Hono<AppEnvironment>();

  router.get("/", async (context) =>
    context.json({ items: await services.vibes.listVibes(context.get("actor")) }),
  );
  router.post("/", async (context) =>
    context.json(await services.vibes.createVibe(context.get("actor"), await jsonBody(context)), 201),
  );
  router.get("/:id", async (context) =>
    context.json(await services.vibes.getVibe(context.get("actor"), context.req.param("id"))),
  );
  router.patch("/:id", async (context) =>
    context.json(
      await services.vibes.updateVibe(context.get("actor"), context.req.param("id"), await jsonBody(context)),
    ),
  );
  router.delete("/:id", async (context) => {
    await services.vibes.deleteVibe(context.get("actor"), context.req.param("id"));
    return context.body(null, 204);
  });
  router.get("/:id/objects", async (context) =>
    context.json({ items: await services.vibes.listMediaObjects(context.get("actor"), context.req.param("id")) }),
  );
  router.post("/:id/objects", async (context) => {
    const body = await jsonBody(context);
    await services.vibes.addMediaObjectRefs(context.get("actor"), context.req.param("id"), body.objects);
    return context.body(null, 204);
  });
  router.delete("/:id/objects", async (context) => {
    const body = await jsonBody(context);
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
