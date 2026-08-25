import { eq } from "drizzle-orm";

import type { Database } from "../db/index.ts";
import { dmachines } from "../db/models/dmachine.ts";
import { users } from "../db/models/user.ts";

export class IdentityService {
  constructor(private readonly db: Database) {}

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
