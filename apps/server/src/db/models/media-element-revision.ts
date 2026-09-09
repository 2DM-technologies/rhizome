import {
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { mediaElements } from "./media-element.ts";
import { operations } from "./operation.ts";
import { textEnumCheck, type JsonObject } from "./shared.ts";

/** `inferred` is the only mutable block on an element, so it is the only block with a log. */
export const MediaElementRevisionBlockEnum = ["inferred"] as const;
export type MediaElementRevisionBlock = (typeof MediaElementRevisionBlockEnum)[number];

export const mediaElementRevisions = pgTable(
  "media_element_revisions",
  {
    mediaElementUuid: uuid("media_element_uuid")
      .notNull()
      .references(() => mediaElements.uuid, { onDelete: "cascade" }),
    block: text("block", { enum: MediaElementRevisionBlockEnum }).notNull(),
    rev: integer("rev").notNull(),
    snapshot: jsonb("snapshot").$type<JsonObject | null>(),
    actor: text("actor").notNull(),
    operationUuid: uuid("operation_uuid").references(() => operations.uuid),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (mediaElementRevision) => [
    primaryKey({
      columns: [
        mediaElementRevision.mediaElementUuid,
        mediaElementRevision.block,
        mediaElementRevision.rev,
      ],
    }),
    check(
      "media_element_revisions_block_check",
      textEnumCheck(mediaElementRevision.block, MediaElementRevisionBlockEnum),
    ),
  ],
);

export type DbMediaElementRevision = typeof mediaElementRevisions.$inferSelect;
export type NewDbMediaElementRevision = typeof mediaElementRevisions.$inferInsert;
