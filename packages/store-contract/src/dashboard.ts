import type { FromSchema, JSONSchema } from "json-schema-to-ts";

/** Owner-scoped, lifetime host dashboard totals and account metadata. */
export const dashboardStatsSchema = {
  type: "object",
  required: ["account_created_at", "objects", "elements", "tokens"],
  properties: {
    account_created_at: { type: "string", format: "date-time" },
    objects: { type: "integer", minimum: 0 },
    elements: { type: "integer", minimum: 0 },
    tokens: {
      type: "object",
      required: ["input", "output", "total"],
      properties: {
        input: { type: "integer", minimum: 0 },
        output: { type: "integer", minimum: 0 },
        total: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

export type DashboardStats = FromSchema<typeof dashboardStatsSchema>;
