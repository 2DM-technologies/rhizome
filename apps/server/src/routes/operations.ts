import { operationDocumentSchema } from "@rhizome/store-contract";

import type { Database } from "../db/index.ts";
import { serializeOperation } from "../serializers/operation-serializer.ts";
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
      responses: {
        200: OperationDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        404: ProblemSchema,
        422: ProblemSchema,
      },
    },
    async (context) => {
      const operationsService = new OperationsService({ db, actor: context.get("actor") });
      const authorized = await operationsService.getOperation(context.req.valid("param").id);
      return context.json(
        serializeOperation(authorized.operation, {
          exposeOwnerOnlyResult: authorized.exposeOwnerOnlyResult,
        }),
      );
    },
  );

  return router;
}
