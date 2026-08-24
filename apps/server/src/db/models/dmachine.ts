import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { JsonObject } from "./shared.ts";
import { users } from "./user.ts";

export const dmachines = pgTable(
  "dmachines",
  {
    uuid: uuid("uuid").primaryKey(),
    name: text("name").notNull(),
    ownerUuid: uuid("owner_uuid").references(() => users.uuid),
    trust: text("trust").notNull().default("standard"),
    generated: boolean("generated").notNull().default(false),
    codeHash: text("code_hash").notNull(),
    manifest: jsonb("manifest").$type<JsonObject>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (dmachine) => [
    uniqueIndex("dmachines_name_idx").on(dmachine.name),
    check("dmachines_trust_check", sql`${dmachine.trust} IN ('system', 'standard')`),
  ],
);
