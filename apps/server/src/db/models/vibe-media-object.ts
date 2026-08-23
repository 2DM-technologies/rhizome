import { sql } from "drizzle-orm";
import { check, integer, pgTable, primaryKey, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { mediaObjects } from "./media-object.ts";
import { vibes } from "./vibe.ts";

export const vibeMediaObjects = pgTable(
  "vibe_objects",
  {
    vibeUuid: uuid("vibe_uuid").notNull().references(() => vibes.uuid, { onDelete: "cascade" }),
    mediaObjectUuid: uuid("object_uuid").notNull().references(() => mediaObjects.uuid),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    position: integer("position").notNull(),
  },
  (vibeMediaObject) => [
    primaryKey({ columns: [vibeMediaObject.vibeUuid, vibeMediaObject.mediaObjectUuid] }),
    uniqueIndex("vibe_objects_position_idx").on(vibeMediaObject.vibeUuid, vibeMediaObject.position),
    check("vibe_objects_position_check", sql`${vibeMediaObject.position} >= 0`),
  ],
);
