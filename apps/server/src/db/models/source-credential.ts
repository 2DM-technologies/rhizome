import { customType, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import type { JsonObject } from "./shared.ts";
import { users } from "./user.ts";

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});

export const sourceCredentials = pgTable(
  "source_credentials",
  {
    uuid: uuid("uuid").primaryKey(),
    userUuid: uuid("user_uuid")
      .notNull()
      .references(() => users.uuid, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    secret: bytea("secret").notNull(),
    metadata: jsonb("metadata").$type<JsonObject>(),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (credential) => [
    unique("source_credentials_uuid_user_uuid_unique").on(credential.uuid, credential.userUuid),
  ],
);

export type DbSourceCredential = typeof sourceCredentials.$inferSelect;
export type NewDbSourceCredential = typeof sourceCredentials.$inferInsert;
