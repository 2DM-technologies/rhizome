import { integer, jsonb, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { operations } from "./operation.ts";
import type { JsonObject } from "./shared.ts";

export const meterEntries = pgTable("meter", {
  operationUuid: uuid("operation_uuid").primaryKey().references(() => operations.uuid),
  payer: text("payer").notNull(),
  model: text("model"),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  turns: integer("turns"),
  durationMs: integer("duration_ms"),
  usd: numeric("usd", { precision: 12, scale: 6 }).notNull().default("0"),
  abortReason: text("abort_reason"),
  breakdown: jsonb("breakdown").$type<JsonObject>(),
});
