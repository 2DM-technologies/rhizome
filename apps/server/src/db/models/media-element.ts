import type { MediaElement } from "@rnet/types";
import { bigint, check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { textEnumCheck } from "./shared.ts";
import { users } from "./user.ts";

export const MediaElementKindEnum = ["text", "image", "audio", "video", "document"] as const;
export type MediaElementKind = (typeof MediaElementKindEnum)[number];

export const mediaElements = pgTable(
  "media_elements",
  {
    uuid: uuid("uuid").primaryKey(),
    ownerUuid: uuid("owner_uuid")
      .notNull()
      .references(() => users.uuid),
    contentHash: text("content_hash").notNull(),
    kind: text("kind", { enum: MediaElementKindEnum }).notNull(),
    mime: text("mime").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    alt: text("alt"),
    inferred: jsonb("inferred")
      .$type<NonNullable<MediaElement["inferred"]>>()
      .notNull()
      .default({}),
    rnetSchema: text("rnet_schema").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
    tombstonedAt: timestamp("tombstoned_at", { withTimezone: true }),
  },
  (mediaElement) => [
    check("media_elements_kind_check", textEnumCheck(mediaElement.kind, MediaElementKindEnum)),
    index("media_elements_content_hash_idx").on(mediaElement.contentHash),
    index("media_elements_inferred_idx").using("gin", mediaElement.inferred),
  ],
);

export type DbMediaElement = typeof mediaElements.$inferSelect;
export type NewDbMediaElement = typeof mediaElements.$inferInsert;
