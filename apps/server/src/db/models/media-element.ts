import { sql } from "drizzle-orm";
import { bigint, check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./user.ts";
import { vibes } from "./vibe.ts";

export const mediaElements = pgTable(
  "elements",
  {
    uuid: uuid("uuid").primaryKey(),
    ownerUuid: uuid("owner_uuid").notNull().references(() => users.uuid),
    contentHash: text("content_hash").notNull(),
    kind: text("kind").notNull(),
    mime: text("mime").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    rnetSchema: text("rnet_schema").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
    createdForVibe: uuid("created_for_vibe").references(() => vibes.uuid, { onDelete: "set null" }),
    tombstonedAt: timestamp("tombstoned_at", { withTimezone: true }),
  },
  (mediaElement) => [
    check("elements_kind_check", sql`${mediaElement.kind} IN ('text', 'image', 'audio', 'video', 'document')`),
    index("elements_content_hash_idx").on(mediaElement.contentHash),
  ],
);
