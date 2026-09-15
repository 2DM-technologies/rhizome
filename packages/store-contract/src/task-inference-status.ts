import type { FromSchema, JSONSchema } from "json-schema-to-ts";
import { TASK_PATTERN } from "@rnet/types/patterns";
import { PUSH_TASK_LEVELS } from "./push.ts";

export const taskInferenceStatusQuerySchema = {
  type: "object",
  required: ["level", "task"],
  additionalProperties: false,
  properties: {
    level: { enum: PUSH_TASK_LEVELS },
    task: { type: "string", pattern: TASK_PATTERN },
  },
} as const satisfies JSONSchema;

export const taskInferenceStatusSchema = {
  type: "object",
  required: ["level", "task", "status", "message", "revision", "operation_id"],
  additionalProperties: false,
  properties: {
    ...taskInferenceStatusQuerySchema.properties,
    status: { enum: ["idle", "waiting", "running", "done", "error"] },
    message: { type: ["string", "null"] },
    revision: { type: "integer", minimum: 1 },
    operation_id: { type: ["string", "null"], format: "uuid" },
  },
} as const satisfies JSONSchema;

export type TaskInferenceStatusQuery = FromSchema<typeof taskInferenceStatusQuerySchema>;
export type TaskInferenceStatus = FromSchema<typeof taskInferenceStatusSchema>;
