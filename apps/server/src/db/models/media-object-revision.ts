import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { mediaObjects } from "./media-object.ts";
import { operations } from "./operation.ts";
import type { JsonObject } from "./shared.ts";

export const mediaObjectRevisions = pgTable(
  "object_revisions",
  {
    mediaObjectUuid: uuid("object_uuid").notNull().references(() => mediaObjects.uuid, { onDelete: "cascade" }),
    block: text("block").notNull(),
    rev: integer("rev").notNull(),
    snapshot: jsonb("snapshot").$type<JsonObject | null>(),
    actor: text("actor").notNull(),
    operationUuid: uuid("operation_uuid").references(() => operations.uuid),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (mediaObjectRevision) => [
    primaryKey({ columns: [mediaObjectRevision.mediaObjectUuid, mediaObjectRevision.block, mediaObjectRevision.rev] }),
    check("object_revisions_block_check", sql`${mediaObjectRevision.block} IN ('source', 'user', 'inferred')`),
  ],
);
