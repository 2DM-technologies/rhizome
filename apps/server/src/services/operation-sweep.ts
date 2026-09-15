import { and, inArray } from "drizzle-orm";
import type { Database } from "../db/index.ts";
import { operations } from "../db/models/operation.ts";
import { ingestionSourceFetches } from "../db/models/ingestion-source-fetch.ts";

/** Startup only: no process-local run can survive a server restart. */
export async function sweepInterruptedOperations(db: Database): Promise<void> {
  await db.transaction(async (transaction) => {
    const interrupted = await transaction
      .update(operations)
      .set({ status: "failed", error: "interrupted", finishedAt: new Date() })
      .where(inArray(operations.status, ["queued", "running"]))
      .returning({ uuid: operations.uuid });
    if (!interrupted.length) return;
    await transaction
      .update(ingestionSourceFetches)
      .set({ status: "rejected", errorCode: "interrupted" })
      .where(
        and(
          inArray(
            ingestionSourceFetches.operationUuid,
            interrupted.map(({ uuid }) => uuid),
          ),
          inArray(ingestionSourceFetches.status, ["fetching", "fetched", "verified"]),
        ),
      );
  });
}
