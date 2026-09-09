import { OPERATION_KINDS, OPERATION_STATUSES } from "@rhizome/store-contract";
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { textEnumCheck, type JsonObject } from "./shared.ts";
import { users } from "./user.ts";
import { vibes } from "./vibe.ts";

export const OperationKindEnum = OPERATION_KINDS;
export type OperationKind = (typeof OperationKindEnum)[number];

export const OperationStatusEnum = OPERATION_STATUSES;
export type OperationStatus = (typeof OperationStatusEnum)[number];

export const operations = pgTable(
  "operations",
  {
    uuid: uuid("uuid").primaryKey(),
    kind: text("kind", { enum: OperationKindEnum }).notNull(),
    status: text("status", { enum: OperationStatusEnum }).notNull(),
    invokedBy: text("invoked_by").notNull(),
    ownerUuid: uuid("owner_uuid")
      .notNull()
      .references(() => users.uuid),
    vibeUuid: uuid("vibe_uuid").references(() => vibes.uuid, { onDelete: "set null" }),
    request: jsonb("request").$type<JsonObject>().notNull(),
    result: jsonb("result").$type<JsonObject>(),
    reviewDigest: text("review_digest"),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (operation) => [
    check("operations_kind_check", textEnumCheck(operation.kind, OperationKindEnum)),
    check("operations_status_check", textEnumCheck(operation.status, OperationStatusEnum)),
    index("operations_status_idx").on(operation.status),
    index("operations_invoked_by_idx").on(operation.invokedBy),
    index("operations_vibe_uuid_idx").on(operation.vibeUuid),
    index("operations_owner_uuid_idx").on(operation.ownerUuid),
  ],
);

export type DbOperation = typeof operations.$inferSelect;
export type NewDbOperation = typeof operations.$inferInsert;
