import { eq } from "drizzle-orm";

import type { Database } from "../db/index.ts";
import { GRANT_SCOPE } from "../db/models/grant.ts";
import { operations, type DbOperation } from "../db/models/operation.ts";
import { grantMissing, notFound, Problem } from "../errors.ts";
import { AccessService } from "./access-service.ts";
import type { ServiceContext } from "./types.ts";

export interface AuthorizedOperation {
  exposeOwnerOnlyResult: boolean;
  operation: DbOperation;
}

export class OperationsService {
  private readonly db: Database;
  private readonly access: AccessService;
  private readonly actor: ServiceContext["actor"];

  constructor(context: ServiceContext) {
    this.db = context.db;
    this.access = new AccessService(context);
    this.actor = context.actor;
  }

  async getOperation(uuid: string): Promise<AuthorizedOperation> {
    let [operation] = await this.db.select().from(operations).where(eq(operations.uuid, uuid));
    if (!operation) throw notFound("Operation");
    if (operation.vibeUuid) {
      try {
        if (operation.request.mode === "import_preview") {
          await this.access.assertVibeOwner(operation.vibeUuid);
        } else if (operation.kind === "pull") {
          await this.access.assertVibeScope(operation.vibeUuid, GRANT_SCOPE.PULL);
        } else {
          await this.access.assertVibeScope(operation.vibeUuid, GRANT_SCOPE.READ);
        }
      } catch (error) {
        if (!(error instanceof Problem) || ![403, 404].includes(error.status)) throw error;
        // Deletion can commit after the operation read, clearing its foreign key before
        // the scope lookup. Only use deleted-Vibe access rules when a fresh row proves it.
        const [current] = await this.db.select().from(operations).where(eq(operations.uuid, uuid));
        if (!current) throw notFound("Operation");
        if (current.vibeUuid !== null) throw error;
        operation = current;
      }
    }
    const isOwner = this.actor.kind === "user" && this.actor.uuid === operation.ownerUuid;
    if (!operation.vibeUuid) {
      await this.access.assertAuthenticated();
      // Deleted Vibes revoke delegated access to push results, which contain member URIs.
      // Other operation kinds retain the original invoker's existing redacted view.
      if (!isOwner && (operation.kind === "push" || this.actor.subject !== operation.invokedBy))
        throw grantMissing("operation");
    }
    return { exposeOwnerOnlyResult: isOwner, operation };
  }
}
