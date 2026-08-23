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

export const machines = pgTable(
  "machines",
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
  (machine) => [
    uniqueIndex("machines_name_idx").on(machine.name),
    check("machines_trust_check", sql`${machine.trust} IN ('system', 'standard')`),
  ],
);
