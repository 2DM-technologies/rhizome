import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import type { JsonObject } from "./shared.ts";

export const users = pgTable("users", {
  uuid: uuid("uuid").primaryKey(),
  name: text("name"),
  handle: text("handle").notNull().unique(),
  inferred: jsonb("inferred").$type<JsonObject>().notNull().default({}),
  avatarHash: text("avatar_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DbUser = typeof users.$inferSelect;
export type NewDbUser = typeof users.$inferInsert;
