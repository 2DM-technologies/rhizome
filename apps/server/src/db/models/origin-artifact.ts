import { bigint, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { users } from "./user.ts";

export const originArtifacts = pgTable(
  "origins",
  {
    uuid: uuid("uuid").primaryKey(),
    ownerUuid: uuid("owner_uuid")
      .notNull()
      .references(() => users.uuid),
    contentHash: text("content_hash").notNull(),
    mime: text("mime").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    label: text("label"),
    rnetSchema: text("rnet_schema").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    tombstonedAt: timestamp("tombstoned_at", { withTimezone: true }),
  },
  (originArtifact) => [
    index("origins_content_hash_idx").on(originArtifact.contentHash),
    unique("origins_uuid_owner_uuid_unique").on(originArtifact.uuid, originArtifact.ownerUuid),
  ],
);

export type DbOriginArtifact = typeof originArtifacts.$inferSelect;
export type NewDbOriginArtifact = typeof originArtifacts.$inferInsert;
