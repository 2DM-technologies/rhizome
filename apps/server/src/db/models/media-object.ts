import type { MediaObject } from "@rnet/types";
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import type { JsonObject } from "./shared.ts";
import { users } from "./user.ts";
import { vibes } from "./vibe.ts";

export const mediaObjects = pgTable(
  "media_objects",
  {
    uuid: uuid("uuid").primaryKey(),
    ownerUuid: uuid("owner_uuid").notNull().references(() => users.uuid),
    createdBy: text("created_by").notNull(),
    createdForVibe: uuid("created_for_vibe").references(() => vibes.uuid, { onDelete: "set null" }),
    type: text("type").notNull(),
    keys: jsonb("keys").$type<Record<string, string>>().notNull().default({}),
    source: jsonb("source").$type<MediaObject["source"]>().notNull(),
    sourceRev: integer("source_rev").notNull().default(1),
    user: jsonb("user").$type<MediaObject["user"]>(),
    userRev: integer("user_rev").notNull().default(0),
    inferred: jsonb("inferred").$type<NonNullable<MediaObject["inferred"]>>().notNull().default({}),
    extensions: jsonb("extensions").$type<JsonObject>().notNull().default({}),
    rnetSchema: text("rnet_schema").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (mediaObject) => [
    index("media_objects_type_idx").on(mediaObject.type),
    index("media_objects_keys_idx").using("gin", mediaObject.keys),
    index("media_objects_inferred_idx").using("gin", mediaObject.inferred),
  ],
);
