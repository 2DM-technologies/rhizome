import { eq } from "drizzle-orm";

import { DEV_MACHINE_UUID, DEV_USER_UUID } from "../auth.ts";
import type { Database } from "../db/index.ts";
import { machines } from "../db/models/machine.ts";
import { users } from "../db/models/user.ts";

export class IdentityService {
  constructor(private readonly db: Database) {}

  async seedDevelopmentIdentities(): Promise<void> {
    await this.db
      .insert(users)
      .values({ uuid: DEV_USER_UUID, handle: "noah", name: "Development User" })
      .onConflictDoNothing();
    await this.db
      .insert(machines)
      .values({
        uuid: DEV_MACHINE_UUID,
        name: "rbudget",
        trust: "standard",
        codeHash: `sha256:${"0".repeat(64)}`,
        manifest: { seeded: true },
      })
      .onConflictDoNothing();
  }

  async hasMachineName(name: string): Promise<boolean> {
    const [machine] = await this.db
      .select({ uuid: machines.uuid })
      .from(machines)
      .where(eq(machines.name, name));
    return Boolean(machine);
  }

  async hasMachineUuid(uuid: string): Promise<boolean> {
    const [machine] = await this.db
      .select({ uuid: machines.uuid })
      .from(machines)
      .where(eq(machines.uuid, uuid));
    return Boolean(machine);
  }

  async hasUserUuid(uuid: string): Promise<boolean> {
    const [user] = await this.db
      .select({ uuid: users.uuid })
      .from(users)
      .where(eq(users.uuid, uuid));
    return Boolean(user);
  }
}
