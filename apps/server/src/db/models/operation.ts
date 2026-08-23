import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import type { JsonObject } from "./shared.ts";
import { vibes } from "./vibe.ts";

export const operations = pgTable(
  "operations",
  {
    uuid: uuid("uuid").primaryKey(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    invokedBy: text("invoked_by").notNull(),
    vibeUuid: uuid("vibe_uuid").references(() => vibes.uuid),
    request: jsonb("request").$type<JsonObject>().notNull(),
    result: jsonb("result").$type<JsonObject>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (operation) => [
    check("operations_kind_check", sql`${operation.kind} IN ('push', 'pull', 'agent')`),
    check(
      "operations_status_check",
      sql`${operation.status} IN ('queued', 'running', 'done', 'failed', 'aborted')`,
    ),
    index("operations_status_idx").on(operation.status),
    index("operations_invoked_by_idx").on(operation.invokedBy),
  ],
);
