import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { ingestionSources } from "./ingestion-source.ts";
import { mediaObjects } from "./media-object.ts";

/**
 * Internal pull bookkeeping. rNet object identity remains the MediaObject UUID; this table
 * remembers which stable parser identity a configured source has already emitted.
 */
export const ingestionSourceObjects = pgTable(
  "ingestion_source_objects",
  {
    sourceUuid: uuid("source_uuid")
      .notNull()
      .references(() => ingestionSources.uuid, { onDelete: "cascade" }),
    identity: text("identity").notNull(),
    mediaObjectUuid: uuid("media_object_uuid")
      .notNull()
      .references(() => mediaObjects.uuid),
    candidateDigest: text("candidate_digest").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (binding) => [
    primaryKey({ columns: [binding.sourceUuid, binding.identity] }),
    uniqueIndex("ingestion_source_objects_source_object_unique_idx").on(
      binding.sourceUuid,
      binding.mediaObjectUuid,
    ),
    index("ingestion_source_objects_object_idx").on(binding.mediaObjectUuid),
  ],
);

export type DbIngestionSourceObject = typeof ingestionSourceObjects.$inferSelect;
export type NewDbIngestionSourceObject = typeof ingestionSourceObjects.$inferInsert;
