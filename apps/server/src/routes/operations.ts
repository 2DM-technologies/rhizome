import { Hono } from "hono";

import type { Database } from "../db/index.ts";
import { OperationService } from "../services/operations.ts";
import { jsonSchema, rnetRoute } from "./contracts.ts";
import type { AppEnvironment } from "./types.ts";

const operationDocumentSchema = jsonSchema({
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
});

export function createOperationRoutes(db: Database) {
  const router = new Hono<AppEnvironment>();

  router.get("/:id", rnetRoute({ responses: { 200: operationDocumentSchema } }), async (context) => {
    const operationService = new OperationService({ db, actor: context.get("actor") });
    const operation = await operationService.getOperation(context.req.param("id"));
    return context.json({
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
