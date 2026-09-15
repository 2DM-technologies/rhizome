import type { Vibe } from "@rnet/types";
import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import type { JsonObject } from "./shared.ts";
import { users } from "./user.ts";

export const vibes = pgTable("vibes", {
  uuid: uuid("uuid").primaryKey(),
  title: text("title").notNull(),
  ownerUuid: uuid("owner_uuid")
    .notNull()
    .references(() => users.uuid),
  rnetSchema: text("rnet_schema").notNull(),
  inferred: jsonb("inferred").$type<NonNullable<Vibe["inferred"]>>().notNull().default({}),
  pullConfig: jsonb("pull_config").$type<Vibe["pull"]>(),
  extensions: jsonb("extensions").$type<JsonObject>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  rev: integer("rev").notNull().default(1),
});

export type DbVibe = typeof vibes.$inferSelect;
export type NewDbVibe = typeof vibes.$inferInsert;
