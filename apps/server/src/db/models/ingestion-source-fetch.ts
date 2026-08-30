import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { ingestionSources } from "./ingestion-source.ts";
import { operations } from "./operation.ts";
import { originArtifacts } from "./origin-artifact.ts";
import { textEnumCheck } from "./shared.ts";
import { sourceCredentials } from "./source-credential.ts";
import { users } from "./user.ts";

export const INGESTION_SOURCE_FETCH_STATUSES = [
  "fetching",
  "fetched",
  "verified",
  "rejected",
  "committed",
] as const;
export type IngestionSourceFetchStatus = (typeof INGESTION_SOURCE_FETCH_STATUSES)[number];

/**
 * Private, durable connected-source capture history. The source, parser pin, and pre-fetch
 * state digest are immutable; status timestamps advance as raw bytes become an OriginArtifact,
 * pass VERIFY, and are eventually committed. Rows also make failed/zero-transaction fetches
 * auditable without exposing provider credentials or captures through the public source API.
 */
export const ingestionSourceFetches = pgTable(
  "ingestion_source_fetches",
  {
    uuid: uuid("uuid").primaryKey(),
    sourceUuid: uuid("source_uuid").notNull(),
    ownerUuid: uuid("owner_uuid")
      .notNull()
      .references(() => users.uuid, { onDelete: "cascade" }),
    // Public remote sources have no credential; credentialed provider fetches
    // continue to bind this to the source owner's credential.
    credentialUuid: uuid("credential_uuid"),
    operationUuid: uuid("operation_uuid")
      .notNull()
      .references(() => operations.uuid),
    originUuid: uuid("origin_uuid"),
    parserVersion: text("parser_version").notNull(),
    sourceStateDigest: text("source_state_digest").notNull(),
    status: text("status", { enum: INGESTION_SOURCE_FETCH_STATUSES }).notNull().default("fetching"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    committedAt: timestamp("committed_at", { withTimezone: true }),
  },
  (fetch) => [
    foreignKey({
      name: "ingestion_source_fetches_source_owner_fk",
      columns: [fetch.sourceUuid, fetch.ownerUuid],
      foreignColumns: [ingestionSources.uuid, ingestionSources.ownerUuid],
    }).onDelete("cascade"),
    foreignKey({
      name: "ingestion_source_fetches_origin_owner_fk",
      columns: [fetch.originUuid, fetch.ownerUuid],
      foreignColumns: [originArtifacts.uuid, originArtifacts.ownerUuid],
    }),
    foreignKey({
      name: "ingestion_source_fetches_credential_owner_fk",
      columns: [fetch.credentialUuid, fetch.ownerUuid],
      foreignColumns: [sourceCredentials.uuid, sourceCredentials.userUuid],
    }),
    check(
      "ingestion_source_fetches_status_check",
      textEnumCheck(fetch.status, INGESTION_SOURCE_FETCH_STATUSES),
    ),
    uniqueIndex("ingestion_source_fetches_operation_source_unique_idx").on(
      fetch.operationUuid,
      fetch.sourceUuid,
    ),
    uniqueIndex("ingestion_source_fetches_origin_unique_idx").on(fetch.originUuid),
    index("ingestion_source_fetches_source_status_idx").on(
      fetch.sourceUuid,
      fetch.status,
      fetch.createdAt,
    ),
    index("ingestion_source_fetches_credential_created_idx").on(
      fetch.credentialUuid,
      fetch.createdAt,
    ),
  ],
);

export type DbIngestionSourceFetch = typeof ingestionSourceFetches.$inferSelect;
export type NewDbIngestionSourceFetch = typeof ingestionSourceFetches.$inferInsert;
