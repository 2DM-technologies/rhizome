import { jsonb, pgTable, primaryKey, integer, text, timestamp, uuid } from "drizzle-orm/pg-core";

import type { JsonObject } from "./shared.ts";
import { vibes } from "./vibe.ts";

export const vibeRevisions = pgTable(
  "vibe_revisions",
  {
    vibeUuid: uuid("vibe_uuid")
      .notNull()
      .references(() => vibes.uuid, { onDelete: "cascade" }),
    rev: integer("rev").notNull(),
    snapshot: jsonb("snapshot").$type<JsonObject>().notNull(),
    membershipDelta: jsonb("membership_delta").$type<{ added: string[]; removed: string[] }>(),
    actor: text("actor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (vibeRevision) => [primaryKey({ columns: [vibeRevision.vibeUuid, vibeRevision.rev] })],
);

export type DbVibeRevision = typeof vibeRevisions.$inferSelect;
export type NewDbVibeRevision = typeof vibeRevisions.$inferInsert;
