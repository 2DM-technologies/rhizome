import { DEV_DMACHINE_UUID, DEV_OTHER_USER_UUID, DEV_USER_UUID } from "../auth.ts";
import { createDatabase, type Database } from "./index.ts";
import { dmachines } from "./models/dmachine.ts";
import { users } from "./models/user.ts";

export async function seedDb(db: Database): Promise<void> {
  await db
    .insert(users)
    .values([
      { uuid: DEV_USER_UUID, handle: "noah", name: "Development User" },
      { uuid: DEV_OTHER_USER_UUID, handle: "other", name: "Other Development User" },
    ])
    .onConflictDoNothing();
  await db
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

if (import.meta.main) {
  const databaseUrl = process.env.DATABASE_URL ?? "postgres://localhost/rhizome";
  const { db, client } = createDatabase(databaseUrl, { max: 1 });
  try {
    await seedDb(db);
    console.log("Rhizome development identities seeded");
  } finally {
    await client.end();
  }
}
