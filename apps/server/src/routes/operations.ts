import { operationDocumentSchema } from "@rhizome/store-contract";

import type { Database } from "../db/index.ts";
import { OperationsService } from "../services/operation-service.ts";
import { ProblemSchema, RecordIdParamsSchema, jsonSchema } from "./contracts.ts";
import { createRhizomeRouter } from "./rhizome-router.ts";

const OperationDocumentSchema = jsonSchema(operationDocumentSchema);

export function createOperationRoutes(db: Database) {
  const router = createRhizomeRouter();

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
