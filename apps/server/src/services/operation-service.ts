import { eq } from "drizzle-orm";

import type { Database } from "../db/index.ts";
import { GRANT_SCOPE } from "../db/models/grant.ts";
import { operations, type DbOperation } from "../db/models/operation.ts";
import { grantMissing, notFound } from "../errors.ts";
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
    const [operation] = await this.db.select().from(operations).where(eq(operations.uuid, uuid));
    if (!operation) throw notFound("Operation");
    const isOwner = this.actor.kind === "user" && this.actor.uuid === operation.ownerUuid;
    if (operation.vibeUuid) {
      if (operation.request.mode === "import_preview") {
        await this.access.assertVibeOwner(operation.vibeUuid);
      } else if (operation.kind === "pull") {
        await this.access.assertVibeScope(operation.vibeUuid, GRANT_SCOPE.PULL);
      } else {
        await this.access.assertVibeScope(operation.vibeUuid, GRANT_SCOPE.READ);
      }
    } else {
      await this.access.assertAuthenticated();
      // Once the Vibe is gone there is no grant to check: the owner and the original invoker
      // keep access; a delegated invoker sees only the redacted view.
      if (!isOwner && this.actor.subject !== operation.invokedBy) throw grantMissing("operation");
    }
    return { exposeOwnerOnlyResult: isOwner, operation };
  }
}
