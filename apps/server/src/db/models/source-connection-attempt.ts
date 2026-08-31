import { sql } from "drizzle-orm";
import {
  check,
  customType,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { sourceCredentials } from "./source-credential.ts";
import { textEnumCheck, type JsonObject } from "./shared.ts";
import { users } from "./user.ts";

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});

export const SOURCE_CONNECTION_ATTEMPT_STATUSES = [
  "pending",
  "exchanging",
  "succeeded",
  "rejected",
  "failed",
  "expired",
] as const;
export type SourceConnectionAttemptStatus = (typeof SOURCE_CONNECTION_ATTEMPT_STATUSES)[number];

/** Durable OAuth state. Raw state, verifier, authorization code, and tokens never appear here. */
export const sourceConnectionAttempts = pgTable(
  "source_connection_attempts",
  {
    uuid: uuid("uuid").primaryKey(),
    userUuid: uuid("user_uuid")
      .notNull()
      .references(() => users.uuid, { onDelete: "cascade" }),
    skillId: text("skill_id").notNull(),
    connectorVersion: text("connector_version").notNull(),
    stateHash: text("state_hash").notNull(),
    browserBindingHash: text("browser_binding_hash").notNull(),
    verifier: bytea("verifier").notNull(),
    callbackUrl: text("callback_url").notNull(),
    returnUrl: text("return_url").notNull(),
    intent: jsonb("intent").$type<JsonObject>().notNull(),
    status: text("status", { enum: SOURCE_CONNECTION_ATTEMPT_STATUSES })
      .notNull()
      .default("pending"),
    credentialUuid: uuid("credential_uuid"),
    errorCode: text("error_code"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (attempt) => [
    foreignKey({
      name: "source_connection_attempts_credential_owner_skill_version_fk",
      columns: [
        attempt.credentialUuid,
        attempt.userUuid,
        attempt.skillId,
        attempt.connectorVersion,
      ],
      foreignColumns: [
        sourceCredentials.uuid,
        sourceCredentials.userUuid,
        sourceCredentials.skillId,
        sourceCredentials.connectorVersion,
      ],
    }),
    check(
      "source_connection_attempts_status_check",
      textEnumCheck(attempt.status, SOURCE_CONNECTION_ATTEMPT_STATUSES),
    ),
    check(
      "source_connection_attempts_result_check",
      sql`(
        (${attempt.status} IN ('pending', 'exchanging') AND ${attempt.credentialUuid} IS NULL AND ${attempt.errorCode} IS NULL AND ${attempt.completedAt} IS NULL) OR
        (${attempt.status} = 'succeeded' AND ${attempt.credentialUuid} IS NOT NULL AND ${attempt.errorCode} IS NULL AND ${attempt.completedAt} IS NOT NULL) OR
        (${attempt.status} IN ('rejected', 'failed', 'expired') AND ${attempt.credentialUuid} IS NULL AND ${attempt.errorCode} IS NOT NULL AND ${attempt.completedAt} IS NOT NULL)
      )`,
    ),
    uniqueIndex("source_connection_attempts_state_hash_unique_idx").on(attempt.stateHash),
    index("source_connection_attempts_owner_created_idx").on(attempt.userUuid, attempt.createdAt),
  ],
);

export type DbSourceConnectionAttempt = typeof sourceConnectionAttempts.$inferSelect;
export type NewDbSourceConnectionAttempt = typeof sourceConnectionAttempts.$inferInsert;
