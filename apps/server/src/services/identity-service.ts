import { eq } from "drizzle-orm";

import { DEV_DMACHINE_UUID, DEV_OTHER_USER_UUID, DEV_USER_UUID } from "../auth.ts";
import type { Database } from "../db/index.ts";
import { dmachines } from "../db/models/dmachine.ts";
import { users } from "../db/models/user.ts";

export class IdentityService {
  constructor(private readonly db: Database) {}

  async seedDevelopmentIdentities(): Promise<void> {
    await this.db
      .insert(users)
      .values([
        { uuid: DEV_USER_UUID, handle: "noah", name: "Development User" },
        { uuid: DEV_OTHER_USER_UUID, handle: "other", name: "Other Development User" },
      ])
      .onConflictDoNothing();
    await this.db
      .insert(dmachines)
      .values({
        uuid: DEV_DMACHINE_UUID,
        name: "rbudget",
        trust: "standard",
        codeHash: `sha256:${"0".repeat(64)}`,
        manifest: { seeded: true },
      })
      .onConflictDoNothing();
  }

  async hasDmachineName(name: string): Promise<boolean> {
    const [dmachine] = await this.db
      .select({ uuid: dmachines.uuid })
      .from(dmachines)
      .where(eq(dmachines.name, name));
    return Boolean(dmachine);
  }

  async hasDmachineUuid(uuid: string): Promise<boolean> {
    const [dmachine] = await this.db
      .select({ uuid: dmachines.uuid })
      .from(dmachines)
      .where(eq(dmachines.uuid, uuid));
    return Boolean(dmachine);
  }

  async hasUserUuid(uuid: string): Promise<boolean> {
    const [user] = await this.db
      .select({ uuid: users.uuid })
      .from(users)
      .where(eq(users.uuid, uuid));
    return Boolean(user);
  }
}
