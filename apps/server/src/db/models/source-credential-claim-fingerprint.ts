import { foreignKey, index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { sourceCredentialClaimAttempts } from "./source-credential-claim-attempt.ts";

/**
 * Key-rotation aliases for a one-time setup token. Every retained key contributes an HMAC,
 * so application instances with different active keys still converge on the same claim row.
 */
export const sourceCredentialClaimFingerprints = pgTable(
  "source_credential_claim_fingerprints",
  {
    skillId: text("skill_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    attemptUuid: uuid("attempt_uuid").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (fingerprint) => [
    primaryKey({
      name: "source_credential_claim_fingerprints_pk",
      columns: [fingerprint.skillId, fingerprint.fingerprint],
    }),
    foreignKey({
      name: "source_credential_claim_fingerprints_attempt_fk",
      columns: [fingerprint.attemptUuid],
      foreignColumns: [sourceCredentialClaimAttempts.uuid],
    }).onDelete("cascade"),
    index("source_credential_claim_fingerprints_attempt_idx").on(fingerprint.attemptUuid),
  ],
);

export type DbSourceCredentialClaimFingerprint =
  typeof sourceCredentialClaimFingerprints.$inferSelect;
