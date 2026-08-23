import { sql } from "drizzle-orm";
import { bigint, check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./user.ts";

export const mediaElements = pgTable(
  "media_elements",
  {
    uuid: uuid("uuid").primaryKey(),
    ownerUuid: uuid("owner_uuid")
      .notNull()
      .references(() => users.uuid),
    contentHash: text("content_hash").notNull(),
    kind: text("kind").notNull(),
    mime: text("mime").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    rnetSchema: text("rnet_schema").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
    tombstonedAt: timestamp("tombstoned_at", { withTimezone: true }),
  },
  (mediaElement) => [
    check(
      "media_elements_kind_check",
      sql`${mediaElement.kind} IN ('text', 'image', 'audio', 'video', 'document')`,
    ),
    index("media_elements_content_hash_idx").on(mediaElement.contentHash),
  ],
);
