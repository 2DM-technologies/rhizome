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

import { mediaObjects } from "./media-object.ts";
import { operations } from "./operation.ts";
import { textEnumCheck, type JsonObject } from "./shared.ts";

export const MediaObjectRevisionBlockEnum = ["source", "user", "inferred"] as const;
export type MediaObjectRevisionBlock = (typeof MediaObjectRevisionBlockEnum)[number];

export const mediaObjectRevisions = pgTable(
  "media_object_revisions",
  {
    mediaObjectUuid: uuid("media_object_uuid")
      .notNull()
      .references(() => mediaObjects.uuid, { onDelete: "cascade" }),
    block: text("block", { enum: MediaObjectRevisionBlockEnum }).notNull(),
    rev: integer("rev").notNull(),
    snapshot: jsonb("snapshot").$type<JsonObject | null>(),
    actor: text("actor").notNull(),
    operationUuid: uuid("operation_uuid").references(() => operations.uuid),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (mediaObjectRevision) => [
    primaryKey({
      columns: [
        mediaObjectRevision.mediaObjectUuid,
        mediaObjectRevision.block,
        mediaObjectRevision.rev,
      ],
    }),
    check(
      "media_object_revisions_block_check",
      textEnumCheck(mediaObjectRevision.block, MediaObjectRevisionBlockEnum),
    ),
  ],
);

export type DbMediaObjectRevision = typeof mediaObjectRevisions.$inferSelect;
export type NewDbMediaObjectRevision = typeof mediaObjectRevisions.$inferInsert;
