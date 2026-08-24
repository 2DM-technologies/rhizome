import { eq } from "drizzle-orm";

import type { Database } from "../db/index.ts";
import { GRANT_SCOPE } from "../db/models/grant.ts";
import { operations } from "../db/models/operation.ts";
import { notFound } from "../errors.ts";
import { AccessService } from "./access-service.ts";
import type { ServiceContext } from "./types.ts";

export type DbOperation = typeof operations.$inferSelect;

export class OperationService {
  private readonly db: Database;
  private readonly access: AccessService;

  constructor(context: ServiceContext) {
    this.db = context.db;
    this.access = new AccessService(context);
  }

  async getOperation(uuid: string): Promise<DbOperation> {
    const [operation] = await this.db.select().from(operations).where(eq(operations.uuid, uuid));
    if (!operation) throw notFound("Operation");
    if (operation.vibeUuid) {
      await this.access.assertVibeScope(operation.vibeUuid, GRANT_SCOPE.READ);
    } else await this.access.assertAuthenticated();
    return operation;
  }
}
