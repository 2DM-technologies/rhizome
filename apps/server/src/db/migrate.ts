import { migrate } from "drizzle-orm/postgres-js/migrator";

import { loadConfig } from "../config.ts";
import { createDatabase } from "./index.ts";

const { databaseUrl } = loadConfig();
const { db, client } = createDatabase(databaseUrl, { max: 1 });

try {
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  console.log("Rhizome database migrations applied");
} finally {
  await client.end();
}
