import type { Database } from "../db/index.ts";
import { OperationKindEnum, OperationStatusEnum } from "../db/models/operation.ts";
import { OperationsService } from "../services/operation-service.ts";
import { ProblemSchema, RecordIdParamsSchema, jsonSchema } from "./contracts.ts";
import { createRnetRouter } from "./rnet-router.ts";

const OperationDocumentSchema = jsonSchema({
  type: "object",
  required: ["operation_id", "kind", "status", "request", "result", "error", "created_at"],
  properties: {
    operation_id: { type: "string", format: "uuid" },
    kind: { enum: OperationKindEnum },
    status: { enum: OperationStatusEnum },
    request: { type: "object" },
    result: { type: ["object", "null"] },
    error: { type: ["string", "null"] },
    created_at: { type: "string", format: "date-time" },
    finished_at: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
});

export function createOperationRoutes(db: Database) {
  const router = createRnetRouter();

  router.get(
    "/:id",
    {
      operationId: "getOperation",
      request: { param: RecordIdParamsSchema },
      responses: { 200: OperationDocumentSchema, 422: ProblemSchema },
    },
    async (context) => {
      const operationsService = new OperationsService({ db, actor: context.get("actor") });
      const operation = await operationsService.getOperation(context.req.valid("param").id);
      const document = {
        operation_id: operation.uuid,
        kind: operation.kind,
        status: operation.status,
        request: operation.request,
        result: operation.result,
        error: operation.error,
        created_at: operation.createdAt.toISOString(),
        ...(operation.finishedAt ? { finished_at: operation.finishedAt.toISOString() } : {}),
      };
      return context.json(document);
    },
  );

  return router;
}
