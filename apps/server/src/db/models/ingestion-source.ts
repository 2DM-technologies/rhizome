import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { originArtifacts } from "./origin-artifact.ts";
import { users } from "./user.ts";

export const INGESTION_SOURCE_KINDS = ["origin"] as const;
export type IngestionSourceKind = (typeof INGESTION_SOURCE_KINDS)[number];

export const ingestionSources = pgTable(
  "ingestion_sources",
  {
    uuid: uuid("uuid").primaryKey(),
    ownerUuid: uuid("owner_uuid")
      .notNull()
      .references(() => users.uuid, { onDelete: "cascade" }),
    kind: text("kind", { enum: INGESTION_SOURCE_KINDS }).notNull(),
    parser: text("parser").notNull(),
    parserVersion: text("parser_version").notNull(),
    originUuid: uuid("origin_uuid").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (source) => [
    unique("ingestion_sources_uuid_owner_uuid_unique").on(source.uuid, source.ownerUuid),
    check("ingestion_sources_kind_check", sql`${source.kind} = 'origin'`),
    foreignKey({
      name: "ingestion_sources_origin_owner_fk",
      columns: [source.originUuid, source.ownerUuid],
      foreignColumns: [originArtifacts.uuid, originArtifacts.ownerUuid],
    }),
  ],
);

export type DbIngestionSource = typeof ingestionSources.$inferSelect;
export type NewDbIngestionSource = typeof ingestionSources.$inferInsert;
