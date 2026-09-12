import type { MediaObject } from "@rnet/types";
import { TASK_PATTERN } from "@rnet/types/patterns";
import { mediaObjectSchema, vibeSchema } from "@rnet/types/schemas";
import type { FromSchema, JSONSchema } from "json-schema-to-ts";

import type { OperationDocument } from "./index.ts";

export const PUSH_TASK_LEVELS = ["element", "object", "vibe"] as const;
export const VIBE_VIEWS = [
  "datatable",
  "mediaboard",
  "simplelist",
  "tweetfeed",
  "fitness_log",
] as const;
export const STORE_WRITER = "rhizome" as const;
export type StoreTaskKey = `${typeof STORE_WRITER}:${string}`;

export function storeTaskKey(task: string): StoreTaskKey {
  if (!new RegExp(TASK_PATTERN).test(task)) throw new Error("Invalid push task name");
  return `${STORE_WRITER}:${task}`;
}

export const RECORD_POINTER_PATTERN = "^(/[^/~]*(~[01][^/~]*)*)+$";
export const recordPointerSchema = { type: "string", pattern: RECORD_POINTER_PATTERN } as const;
export type RecordPointer = FromSchema<typeof recordPointerSchema>;

/** Resolve only fields in this document; element references never traverse into another record. */
export function resolvePointer(document: MediaObject, pointer: string): unknown {
  if (!new RegExp(RECORD_POINTER_PATTERN).test(pointer)) return undefined;
  const parts = pointer
    .slice(1)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (parts[0] === "elements" && parts.length > 2) return undefined;
  let value: unknown = document;
  for (const part of parts) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, part))
      return undefined;
    if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

const taskNameSchema = { type: "string", pattern: TASK_PATTERN } as const;
const taskKeySchema = {
  type: "string",
  pattern: `^${STORE_WRITER}:${TASK_PATTERN.slice(1)}`,
} as const;

export const pushVibeRequestSchema = {
  anyOf: [
    {
      type: "object",
      required: ["level", "task"],
      additionalProperties: false,
      properties: {
        level: { const: "object" },
        task: taskNameSchema,
        selection: {
          type: "array",
          minItems: 1,
          maxItems: 500,
          uniqueItems: true,
          items: vibeSchema.properties.objects.items,
        },
      },
    },
    {
      type: "object",
      required: ["level", "task"],
      additionalProperties: false,
      properties: {
        level: { const: "element" },
        task: taskNameSchema,
        selection: {
          type: "array",
          minItems: 1,
          maxItems: 2000,
          uniqueItems: true,
          items: mediaObjectSchema.properties.elements.items.properties.uri,
        },
      },
    },
    {
      type: "object",
      required: ["level", "task"],
      additionalProperties: false,
      properties: { level: { const: "vibe" }, task: taskNameSchema },
    },
  ],
} as const satisfies JSONSchema;
export type PushVibeRequest = FromSchema<typeof pushVibeRequestSchema>;

export const pushTaskManifestSchema = {
  type: "object",
  required: ["level", "name", "label", "description", "output_schema"],
  additionalProperties: false,
  properties: {
    level: { enum: PUSH_TASK_LEVELS },
    name: taskNameSchema,
    label: { type: "string" },
    description: { type: "string" },
    output_schema: { type: "object" },
  },
} as const satisfies JSONSchema;
export const pushTaskManifestsResponseSchema = {
  type: "object",
  required: ["tasks"],
  additionalProperties: false,
  properties: { tasks: { type: "array", items: pushTaskManifestSchema } },
} as const satisfies JSONSchema;
export type PushTaskManifest = FromSchema<typeof pushTaskManifestSchema>;
export type PushTaskManifestsResponse = FromSchema<typeof pushTaskManifestsResponseSchema>;

export const SKIP_REASONS = [
  "not_applicable",
  "unsupported_media",
  "context_too_large",
  "invalid_output",
  "call_failed",
  "preserved_durable",
  "aborted",
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];
export const MODEL_CONNECTOR_ERROR_KINDS = [
  "auth",
  "invalid_request",
  "rate_limited",
  "provider_unavailable",
  "timeout",
  "aborted",
  "output_truncated",
  "output_refused",
  "output_invalid",
] as const;

const countSchema = { type: "integer", minimum: 0 } as const;
const skipProperties = {
  reason: { enum: SKIP_REASONS },
  code: { enum: MODEL_CONNECTOR_ERROR_KINDS },
} as const;
const skipCodeConstraint = {
  if: { properties: { reason: { const: "call_failed" } } },
  then: {},
  else: { properties: { code: false } },
} as const;
const sharedProperties = {
  task: taskNameSchema,
  model: { type: ["string", "null"] },
  llm_calls: countSchema,
  usage: {
    type: "object",
    required: [
      "tokens_in",
      "cached_tokens_in",
      "tokens_out",
      "usd",
      "served_tiers",
      "tier_assumed",
    ],
    additionalProperties: false,
    properties: {
      tokens_in: countSchema,
      cached_tokens_in: countSchema,
      tokens_out: countSchema,
      usd: { type: "string", pattern: "^[0-9]+\\.[0-9]{6}$" },
      served_tiers: { type: "array", uniqueItems: true, items: { type: "string" } },
      tier_assumed: { type: "boolean" },
    },
  },
  context: {
    type: "object",
    required: ["truncated_objects", "truncated_pointers", "clipped_objects"],
    additionalProperties: false,
    properties: {
      truncated_objects: countSchema,
      truncated_pointers: countSchema,
      clipped_objects: countSchema,
    },
  },
  abort_reason: { enum: ["max_turns", "max_tokens", "max_wall", null] },
} as const;
const sharedRequired = ["task", "model", "llm_calls", "context", "abort_reason"] as const;
const tallySchema = {
  type: "object",
  required: ["selected", "sent", "written", "removed", "preserved_durable", "skipped", "failed"],
  additionalProperties: false,
  properties: {
    selected: countSchema,
    sent: countSchema,
    written: countSchema,
    removed: countSchema,
    preserved_durable: countSchema,
    skipped: countSchema,
    failed: countSchema,
  },
} as const;

function recordOutcomes<const UriSchema extends JSONSchema>(uri: UriSchema) {
  return {
    written: {
      type: "array",
      items: {
        type: "object",
        required: ["uri", "key", "rev"],
        additionalProperties: false,
        properties: { uri, key: taskKeySchema, rev: { type: "integer", minimum: 1 } },
      },
    },
    preserved: { type: "array", items: uri },
    skipped: {
      type: "array",
      items: {
        type: "object",
        required: ["uri", "reason"],
        additionalProperties: false,
        properties: { uri, ...skipProperties, removed: { const: true } },
        allOf: [
          skipCodeConstraint,
          {
            if: { properties: { reason: { const: "not_applicable" } } },
            then: {},
            else: { properties: { removed: false } },
          },
        ],
      },
    },
  } as const;
}

export const pushOperationResultSchema = {
  anyOf: [
    {
      type: "object",
      required: [...sharedRequired, "level", "objects", "written", "preserved", "skipped"],
      additionalProperties: false,
      properties: {
        ...sharedProperties,
        level: { const: "object" },
        objects: tallySchema,
        ...recordOutcomes(vibeSchema.properties.objects.items),
      },
    },
    {
      type: "object",
      required: [...sharedRequired, "level", "elements", "written", "preserved", "skipped"],
      additionalProperties: false,
      properties: {
        ...sharedProperties,
        level: { const: "element" },
        elements: tallySchema,
        ...recordOutcomes(mediaObjectSchema.properties.elements.items.properties.uri),
      },
    },
    {
      type: "object",
      required: [...sharedRequired, "level", "vibe"],
      additionalProperties: false,
      properties: {
        ...sharedProperties,
        level: { const: "vibe" },
        vibe: {
          anyOf: [
            {
              type: "object",
              required: ["outcome", "key", "rev"],
              additionalProperties: false,
              properties: {
                outcome: { const: "written" },
                key: taskKeySchema,
                rev: { type: "integer", minimum: 1 },
              },
            },
            {
              type: "object",
              required: ["outcome", "key"],
              additionalProperties: false,
              properties: { outcome: { const: "preserved_durable" }, key: taskKeySchema },
            },
            {
              type: "object",
              required: ["outcome", "reason"],
              additionalProperties: false,
              properties: { outcome: { const: "skipped" }, ...skipProperties },
              ...skipCodeConstraint,
            },
          ],
        },
      },
    },
  ],
} as const satisfies JSONSchema;
export type PushOperationResult = FromSchema<
  typeof pushOperationResultSchema,
  {
    deserialize: [{ pattern: typeof taskKeySchema; output: StoreTaskKey }];
  }
>;

export function isPushOperation(
  document: OperationDocument,
): document is OperationDocument & { result: PushOperationResult | null } {
  return (document.request as Record<string, unknown>).mode === "push";
}
