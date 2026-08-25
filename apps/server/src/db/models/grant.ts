import type { Grant } from "@rnet/types";
import { jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { vibes } from "./vibe.ts";

export const GRANT_SCOPE = {
  READ: "read",
  WRITE_USER: "write:user",
  WRITE_OBJECTS: "write:objects",
  WRITE_INFERRED: "write:inferred",
  PUSH: "push",
  PULL: "pull",
} as const satisfies Record<string, Grant["scope"][number]>;

export type GrantScope = (typeof GRANT_SCOPE)[keyof typeof GRANT_SCOPE];

export const grants = pgTable(
  "grants",
  {
    vibeUuid: uuid("vibe_uuid")
      .notNull()
      .references(() => vibes.uuid, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    scopes: jsonb("scopes").$type<Grant["scope"]>().notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (grant) => [primaryKey({ columns: [grant.vibeUuid, grant.subject] })],
);

export type DbGrant = typeof grants.$inferSelect;
export type NewDbGrant = typeof grants.$inferInsert;
