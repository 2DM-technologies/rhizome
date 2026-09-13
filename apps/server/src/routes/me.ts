import { dashboardStatsSchema, type DashboardStats } from "@rhizome/store-contract";

import type { Database } from "../db/index.ts";
import { DashboardStatsService } from "../services/dashboard-stats-service.ts";
import { ProblemSchema, jsonSchemaValue } from "./contracts.ts";
import { createRhizomeRouter } from "./rhizome-router.ts";

export function createMeRoutes(db: Database) {
  const router = createRhizomeRouter();
  router.get(
    "/stats",
    {
      operationId: "getDashboardStats",
      auth: "user",
      responses: {
        200: jsonSchemaValue<DashboardStats>(dashboardStatsSchema),
        401: ProblemSchema,
        403: ProblemSchema,
      },
    },
    async (context) => {
      const actor = context.get("actor");
      const stats = await new DashboardStatsService(db).get(actor.uuid);
      return context.json(stats);
    },
  );
  return router;
}
