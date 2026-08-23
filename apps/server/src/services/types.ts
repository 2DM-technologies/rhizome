import type { Actor } from "../auth.ts";
import type { Database } from "../db/index.ts";

export interface ServiceContext {
  db: Database;
  actor: Actor;
}
