import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { originArtifacts } from "./origin-artifact.ts";
import type { JsonObject } from "./shared.ts";
import { sourceCredentials } from "./source-credential.ts";
import { users } from "./user.ts";

export const INGESTION_SOURCE_KINDS = ["origin", "credential", "remote"] as const;
export type IngestionSourceKind = (typeof INGESTION_SOURCE_KINDS)[number];
export const INGESTION_SOURCE_PROVIDERS = ["arena"] as const;
export type IngestionSourceProvider = (typeof INGESTION_SOURCE_PROVIDERS)[number];

export const ingestionSources = pgTable(
  "ingestion_sources",
  {
    uuid: uuid("uuid").primaryKey(),
    ownerUuid: uuid("owner_uuid")
      .notNull()
      .references(() => users.uuid, { onDelete: "cascade" }),
    kind: text("kind", { enum: INGESTION_SOURCE_KINDS }).notNull(),
    provider: text("provider", { enum: INGESTION_SOURCE_PROVIDERS }),
    parser: text("parser").notNull(),
    parserVersion: text("parser_version").notNull(),
    originUuid: uuid("origin_uuid"),
    credentialUuid: uuid("credential_uuid"),
    config: jsonb("config").$type<JsonObject>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (source) => [
    unique("ingestion_sources_uuid_owner_uuid_unique").on(source.uuid, source.ownerUuid),
    check(
      "ingestion_sources_reference_check",
      sql`(
        (${source.kind} = 'origin' AND ${source.originUuid} IS NOT NULL AND ${source.credentialUuid} IS NULL AND ${source.provider} IS NULL) OR
        (${source.kind} = 'credential' AND ${source.credentialUuid} IS NOT NULL AND ${source.originUuid} IS NULL AND ${source.provider} IS NULL) OR
        (${source.kind} = 'remote' AND ${source.originUuid} IS NULL AND ${source.credentialUuid} IS NULL AND ${source.provider} = 'arena')
      )`,
    ),
    foreignKey({
      name: "ingestion_sources_origin_owner_fk",
      columns: [source.originUuid, source.ownerUuid],
      foreignColumns: [originArtifacts.uuid, originArtifacts.ownerUuid],
    }),
    foreignKey({
      name: "ingestion_sources_credential_owner_fk",
      columns: [source.credentialUuid, source.ownerUuid],
      foreignColumns: [sourceCredentials.uuid, sourceCredentials.userUuid],
    }),
  ],
);

export type DbIngestionSource = typeof ingestionSources.$inferSelect;
export type NewDbIngestionSource = typeof ingestionSources.$inferInsert;
