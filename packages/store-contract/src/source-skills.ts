import { UUIDV7_PATTERN } from "@rnet/types/patterns";
import { ingestRecordSchema } from "@rnet/types/schemas";
import type { FromSchema, JSONSchema } from "json-schema-to-ts";

import { pushTaskReferenceSchema } from "./push.ts";

/** Stable package/catalog identity. This is intentionally not a database enum. */
export const SOURCE_SKILL_ID_PATTERN = "^[a-z][a-z0-9_-]{0,63}$";
/** A parser pin is persisted as rNet `source.ingest.skill`, so it must satisfy that schema. */
export const SOURCE_PARSER_VERSION_PATTERN = ingestRecordSchema.properties.skill.pattern;
export const SOURCE_ID_PATTERN = `^source:${UUIDV7_PATTERN.slice(1, -1)}$`;
export const SOURCE_CREDENTIAL_ID_PATTERN = `^credential:${UUIDV7_PATTERN.slice(1, -1)}$`;

export const SOURCE_SKILL_KINDS = ["file", "public_remote", "credentialed_remote"] as const;

export const SOURCE_SKILL_INPUT_TARGETS = ["connection", "source"] as const;
export const SOURCE_SKILL_INPUT_CONTROLS = ["text", "url", "file", "checkbox", "select"] as const;

/** Platform review workflows that a skill may opt into. */
export const SOURCE_SKILL_REVIEW_ACTIONS = ["review_import", "refresh_source"] as const;
export const SOURCE_CREDENTIAL_CLAIM_POLICIES = ["single_use_global"] as const;

export const sourceExecutionLimitsSchema = {
  type: "object",
  required: ["maxCandidates", "maxCaptureBytes", "maxElementBytes", "maxTotalElementBytes"],
  properties: {
    maxCandidates: { type: "integer", minimum: 1, maximum: 2_147_483_647 },
    maxCaptureBytes: { type: "integer", minimum: 1, maximum: 2_147_483_647 },
    maxElementBytes: { type: "integer", minimum: 1, maximum: 2_147_483_647 },
    maxTotalElementBytes: { type: "integer", minimum: 1, maximum: 2_147_483_647 },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

export type SourceExecutionLimits = FromSchema<typeof sourceExecutionLimitsSchema>;

export const sourceCredentialClaimPolicySchema = {
  type: "object",
  required: ["kind"],
  properties: {
    kind: { enum: SOURCE_CREDENTIAL_CLAIM_POLICIES },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

export const claimExchangeConnectionManifestSchema = {
  type: "object",
  required: ["mode", "claim_policy"],
  properties: {
    mode: { const: "claim_exchange" },
    claim_policy: sourceCredentialClaimPolicySchema,
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

export const oauth2PkceConnectionManifestSchema = {
  type: "object",
  required: ["mode", "button_label"],
  properties: {
    mode: { const: "oauth2_pkce" },
    button_label: { type: "string", minLength: 1, maxLength: 256 },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

export const sourceSkillConnectionManifestSchema = {
  oneOf: [claimExchangeConnectionManifestSchema, oauth2PkceConnectionManifestSchema],
} as const satisfies JSONSchema;

export const sourceSkillInputOptionSchema = {
  type: "object",
  required: ["value", "label"],
  properties: {
    value: { type: "string", minLength: 1, maxLength: 512 },
    label: { type: "string", minLength: 1, maxLength: 256 },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

/**
 * Rendering hints only. The skill's server-side request schema remains authoritative.
 * `secret` is required so newly installed skills cannot accidentally inherit an unsafe default.
 */
export const sourceSkillInputFieldSchema = {
  type: "object",
  required: ["name", "label", "target", "control", "required", "secret"],
  properties: {
    name: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
    label: { type: "string", minLength: 1, maxLength: 256 },
    target: { enum: SOURCE_SKILL_INPUT_TARGETS },
    control: { enum: SOURCE_SKILL_INPUT_CONTROLS },
    required: { type: "boolean" },
    secret: { type: "boolean" },
    placeholder: { type: "string", maxLength: 512 },
    help_text: { type: "string", maxLength: 2_048 },
    help_url: { type: "string", format: "uri", pattern: "^https://" },
    accept: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
    options: {
      type: "array",
      minItems: 1,
      items: sourceSkillInputOptionSchema,
    },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

export const importPushPipelineNodeSchema = {
  type: "object",
  required: ["task", "after"],
  properties: {
    task: pushTaskReferenceSchema,
    after: {
      type: "array",
      items: pushTaskReferenceSchema,
      uniqueItems: true,
    },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

export const importPushPipelineSchema = {
  type: "array",
  items: importPushPipelineNodeSchema,
  uniqueItems: true,
} as const satisfies JSONSchema;
export type ImportPushPipeline = FromSchema<typeof importPushPipelineSchema>;

export const sourceSkillManifestSchema = {
  type: "object",
  required: [
    "skill_id",
    "label",
    "description",
    "source_kind",
    "connector_version",
    "parser",
    "limits",
    "input_fields",
    "review_actions",
    "import_push_pipeline",
  ],
  properties: {
    skill_id: { type: "string", pattern: SOURCE_SKILL_ID_PATTERN },
    label: { type: "string", minLength: 1, maxLength: 256 },
    description: { type: "string", minLength: 1, maxLength: 2_048 },
    source_kind: { enum: SOURCE_SKILL_KINDS },
    connector_version: { type: "string", minLength: 1, maxLength: 256 },
    parser: {
      type: "object",
      required: ["name", "version"],
      properties: {
        name: { type: "string", minLength: 1, maxLength: 256 },
        version: {
          type: "string",
          minLength: 1,
          maxLength: 256,
          pattern: SOURCE_PARSER_VERSION_PATTERN,
        },
      },
      additionalProperties: false,
    },
    limits: sourceExecutionLimitsSchema,
    connection: sourceSkillConnectionManifestSchema,
    input_fields: {
      type: "array",
      items: sourceSkillInputFieldSchema,
    },
    review_actions: {
      type: "array",
      items: { enum: SOURCE_SKILL_REVIEW_ACTIONS },
      uniqueItems: true,
    },
    import_push_pipeline: importPushPipelineSchema,
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

export type SourceSkillManifest = FromSchema<typeof sourceSkillManifestSchema>;

export const sourceSkillManifestsResponseSchema = {
  type: "object",
  required: ["skills"],
  properties: {
    skills: { type: "array", items: sourceSkillManifestSchema },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

export type SourceSkillManifestsResponse = FromSchema<typeof sourceSkillManifestsResponseSchema>;

export const SOURCE_ACTION_KINDS = ["review_import"] as const;

export const pendingVibeDestinationSchema = {
  type: "object",
  required: ["kind", "id"],
  properties: {
    kind: { const: "pending_vibe" },
    id: { type: "string", pattern: UUIDV7_PATTERN },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

/**
 * Provider-neutral, server-issued recovery instruction. The continuation is an opaque bearer value
 * whose actor, Vibe, source, action, and expiry are validated by the server before it is consumed.
 */
export const sourceActionRequiredSchema = {
  type: "object",
  required: ["kind", "action", "title", "detail", "source", "continuation_token"],
  properties: {
    kind: { const: "source_action_required" },
    action: { enum: SOURCE_ACTION_KINDS },
    title: { type: "string", minLength: 1, maxLength: 256 },
    detail: { type: "string", minLength: 1, maxLength: 2_048 },
    source: { type: "string", pattern: SOURCE_ID_PATTERN },
    continuation_token: {
      type: "string",
      minLength: 32,
      maxLength: 8_192,
      pattern: "^\\S+$",
    },
    destination: pendingVibeDestinationSchema,
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

export type SourceActionRequired = FromSchema<typeof sourceActionRequiredSchema>;

export const reviewImportContinuationRequestSchema = {
  type: "object",
  required: ["continuation_token"],
  properties: {
    continuation_token: sourceActionRequiredSchema.properties.continuation_token,
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

export type ReviewImportContinuationRequest = FromSchema<
  typeof reviewImportContinuationRequestSchema
>;
