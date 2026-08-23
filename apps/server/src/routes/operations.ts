import { Hono } from "hono";

import type { Services } from "../services/index.ts";
import type { DbOperation } from "../services/operations.ts";
import { defineRoute, jsonResponse, jsonSchema } from "./contracts.ts";
import type { AppEnvironment } from "./types.ts";

interface OperationDocument {
  operation_id: string;
  kind: string;
  status: string;
  request: DbOperation["request"];
  result: DbOperation["result"];
  error: string | null;
  created_at: string;
  finished_at?: string;
}

const getOperationRoute = defineRoute({
  responses: {
    200: jsonSchema<OperationDocument>({
      type: "object",
      required: ["operation_id", "kind", "status", "request", "result", "error", "created_at"],
      properties: {
        operation_id: { type: "string", format: "uuid" },
        kind: { enum: ["push", "pull", "agent"] },
        status: { enum: ["queued", "running", "done", "failed", "aborted"] },
        request: { type: "object" },
        result: { type: ["object", "null"] },
        error: { type: ["string", "null"] },
        created_at: { type: "string", format: "date-time" },
        finished_at: { type: "string", format: "date-time" },
      },
      additionalProperties: false,
    }),
  },
});

export function createOperationRoutes(services: Services) {
  const router = new Hono<AppEnvironment>();

  router.get("/:id", async (context) => {
    const operation = await services.operations.getOperation(context.get("actor"), context.req.param("id"));
    return jsonResponse(context, getOperationRoute, 200, {
      operation_id: operation.uuid,
      kind: operation.kind,
      status: operation.status,
      request: operation.request,
      result: operation.result,
      error: operation.error,
      created_at: operation.createdAt.toISOString(),
      ...(operation.finishedAt ? { finished_at: operation.finishedAt.toISOString() } : {}),
    });
  });

  return router;
}
