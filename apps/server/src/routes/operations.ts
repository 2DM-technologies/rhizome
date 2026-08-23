import { Hono } from "hono";

import type { Services } from "../services/index.ts";
import type { AppEnvironment } from "./types.ts";

export function createOperationRoutes(services: Services) {
  const router = new Hono<AppEnvironment>();

  router.get("/:id", async (context) => {
    const operation = await services.operations.getOperation(context.get("actor"), context.req.param("id"));
    return context.json({
      operation_id: operation.uuid,
      kind: operation.kind,
      status: operation.status,
      request: operation.request,
      result: operation.result,
      error: operation.error,
      created_at: operation.createdAt.toISOString(),
      finished_at: operation.finishedAt?.toISOString(),
    });
  });

  return router;
}
