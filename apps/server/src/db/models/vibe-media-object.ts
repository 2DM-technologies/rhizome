import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";

import { mediaObjects } from "./media-object.ts";
import { vibes } from "./vibe.ts";

export const vibeMediaObjects = pgTable(
  "vibe_media_objects",
  {
    vibeUuid: uuid("vibe_uuid")
      .notNull()
      .references(() => vibes.uuid, { onDelete: "cascade" }),
    mediaObjectUuid: uuid("media_object_uuid")
      .notNull()
      .references(() => mediaObjects.uuid),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    position: integer("position").notNull(),
  },
  (vibeMediaObject) => [
    primaryKey({ columns: [vibeMediaObject.vibeUuid, vibeMediaObject.position] }),
    index("vibe_media_objects_media_object_idx").on(vibeMediaObject.mediaObjectUuid),
    check("vibe_media_objects_position_check", sql`${vibeMediaObject.position} >= 0`),
  ],
);

export type DbVibeMediaObject = typeof vibeMediaObjects.$inferSelect;
export type NewDbVibeMediaObject = typeof vibeMediaObjects.$inferInsert;
