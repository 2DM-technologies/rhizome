import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDatabase } from "./index.ts";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://localhost/rhizome";
const { db, client } = createDatabase(databaseUrl, { max: 1 });

try {
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  console.log("Rhizome database migrations applied");
} finally {
  await client.end();
}
