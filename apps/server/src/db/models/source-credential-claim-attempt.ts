import { sql } from "drizzle-orm";
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

import { sourceCredentials } from "./source-credential.ts";
import { textEnumCheck } from "./shared.ts";
import { users } from "./user.ts";

export const SOURCE_CREDENTIAL_CLAIM_STATUSES = [
  "claiming",
  "succeeded",
  "rejected",
  "ambiguous",
] as const;
export type SourceCredentialClaimStatus = (typeof SOURCE_CREDENTIAL_CLAIM_STATUSES)[number];

/**
 * Durable one-time token ledger. Only an HMAC fingerprint is retained: the setup token is
 * never recoverable from this row. Once provider submission might have begun, a
 * claiming/ambiguous/rejected row is intentionally terminal because POSTing the token twice may
 * disclose a consumed credential. A known pre-submit key-preparation failure may delete only its
 * still-claiming reservation so the untouched provider token remains retryable.
 */
export const sourceCredentialClaimAttempts = pgTable(
  "source_credential_claim_attempts",
  {
    uuid: uuid("uuid").primaryKey(),
    userUuid: uuid("user_uuid")
      .notNull()
      .references(() => users.uuid, { onDelete: "cascade" }),
    skillId: text("skill_id").notNull(),
    tokenFingerprint: text("token_fingerprint").notNull(),
    status: text("status", { enum: SOURCE_CREDENTIAL_CLAIM_STATUSES })
      .notNull()
      .default("claiming"),
    credentialUuid: uuid("credential_uuid"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (attempt) => [
    foreignKey({
      name: "source_credential_claim_attempts_credential_owner_fk",
      columns: [attempt.credentialUuid, attempt.userUuid],
      foreignColumns: [sourceCredentials.uuid, sourceCredentials.userUuid],
    }),
    check(
      "source_credential_claim_attempts_status_check",
      textEnumCheck(attempt.status, SOURCE_CREDENTIAL_CLAIM_STATUSES),
    ),
    check(
      "source_credential_claim_attempts_result_check",
      sql`(
        (${attempt.status} = 'succeeded' AND ${attempt.credentialUuid} IS NOT NULL) OR
        (${attempt.status} <> 'succeeded' AND ${attempt.credentialUuid} IS NULL)
      )`,
    ),
    uniqueIndex("source_credential_claim_attempts_token_unique_idx").on(
      attempt.skillId,
      attempt.tokenFingerprint,
    ),
    index("source_credential_claim_attempts_user_created_idx").on(
      attempt.userUuid,
      attempt.createdAt,
    ),
  ],
);

export type DbSourceCredentialClaimAttempt = typeof sourceCredentialClaimAttempts.$inferSelect;
export type NewDbSourceCredentialClaimAttempt = typeof sourceCredentialClaimAttempts.$inferInsert;
