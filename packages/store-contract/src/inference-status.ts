import type { FromSchema, JSONSchema } from "json-schema-to-ts";
import { TASK_PATTERN } from "@rnet/types/patterns";

export const objectInferenceStatusSchema = {
  type: "object",
  required: ["records"],
  additionalProperties: false,
  properties: {
    records: {
      type: "array",
      items: {
        type: "object",
        required: ["uri", "revision", "tasks"],
        additionalProperties: false,
        properties: {
          uri: { type: "string", pattern: "^rnet://(object|element)/[0-9a-f-]{36}$" },
          revision: { type: "integer", minimum: 0 },
          tasks: {
            type: "array",
            items: {
              type: "object",
              required: ["task", "status", "message"],
              additionalProperties: false,
              properties: {
                task: { type: "string", pattern: TASK_PATTERN },
                status: { enum: ["waiting", "running", "error"] },
                message: { type: ["string", "null"] },
              },
            },
          },
        },
      },
    },
  },
} as const satisfies JSONSchema;

export type ObjectInferenceStatus = FromSchema<typeof objectInferenceStatusSchema>;
export type RecordInferenceStatus = ObjectInferenceStatus["records"][number];
export type InferenceTaskStatus = RecordInferenceStatus["tasks"][number];
