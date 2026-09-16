import {
  pushTaskManifestsResponseSchema,
  type PushTaskManifestsResponse,
} from "@rhizome/store-contract";
import type { PushTaskCatalog } from "../push/task-catalog.ts";
import { jsonSchemaValue } from "./contracts.ts";
import { createRhizomeRouter } from "./rhizome-router.ts";

export function createPushTaskRoutes(catalog: PushTaskCatalog) {
  const router = createRhizomeRouter();
  router.get(
    "/",
    {
      operationId: "listPushTasks",
      auth: "user_or_client",
      responses: {
        200: jsonSchemaValue<PushTaskManifestsResponse>(pushTaskManifestsResponseSchema),
      },
    },
    (context) => context.json({ tasks: catalog.manifests() }),
  );
  return router;
}
