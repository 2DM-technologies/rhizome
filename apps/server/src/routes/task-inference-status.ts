import { taskInferenceStatusQuerySchema, taskInferenceStatusSchema } from "@rhizome/store-contract";
import type { PushService } from "../push/push-service.ts";
import { jsonSchema, ProblemSchema, RecordIdParamsSchema } from "./contracts.ts";
import type { RhizomeRouter } from "./rhizome-router.ts";

const QuerySchema = jsonSchema(taskInferenceStatusQuerySchema);
const StatusSchema = jsonSchema(taskInferenceStatusSchema);

export function registerTaskInferenceStatusRoute(router: RhizomeRouter, push: PushService) {
  router.get(
    "/:id/inference-status",
    {
      operationId: "getTaskInferenceStatus",
      request: { param: RecordIdParamsSchema, query: QuerySchema },
      responses: { 200: StatusSchema, 403: ProblemSchema, 404: ProblemSchema, 422: ProblemSchema },
    },
    async (context) =>
      context.json(
        await push.getTaskInferenceStatus(
          context.req.valid("param").id,
          context.req.valid("query"),
          context.get("actor"),
        ),
      ),
  );
}
