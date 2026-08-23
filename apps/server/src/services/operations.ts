import { eq } from "drizzle-orm";

import type { Actor } from "../auth.ts";
import type { Database } from "../db/index.ts";
import { operations } from "../db/models/operation.ts";
import { notFound } from "../errors.ts";
import type { AccessService } from "./access.ts";

export type DbOperation = typeof operations.$inferSelect;

export class OperationService {
  constructor(
    private readonly db: Database,
    private readonly access: AccessService,
  ) {}

  async getOperation(actor: Actor, uuid: string): Promise<DbOperation> {
    const [operation] = await this.db.select().from(operations).where(eq(operations.uuid, uuid));
    if (!operation) throw notFound("Operation");
    if (operation.vibeUuid) await this.access.assertVibeScope(actor, operation.vibeUuid, "read");
    else await this.access.assertAuthenticated(actor);
    return operation;
  }
}
