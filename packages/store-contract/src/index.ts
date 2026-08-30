import {
  grantSchema,
  ingestRecordSchema,
  mediaElementSchema,
  mediaObjectSchema,
  originArtifactSchema,
  vibeSchema,
} from "@rnet/types/schemas";
import { TASK_PATTERN } from "@rnet/types/patterns";
import type { FromSchema, JSONSchema } from "json-schema-to-ts";

import {
  SOURCE_SKILL_ID_PATTERN,
  SOURCE_CREDENTIAL_ID_PATTERN,
  SOURCE_ID_PATTERN,
  reviewImportContinuationRequestSchema,
  sourceActionRequiredSchema,
  sourceSkillManifestsResponseSchema,
} from "./source-skills.ts";

export {
  SOURCE_ACTION_KINDS,
  SOURCE_CREDENTIAL_CLAIM_POLICIES,
  SOURCE_CREDENTIAL_ID_PATTERN,
  SOURCE_ID_PATTERN,
  SOURCE_SKILL_ID_PATTERN,
  SOURCE_SKILL_INPUT_CONTROLS,
  SOURCE_SKILL_INPUT_TARGETS,
  SOURCE_SKILL_KINDS,
  SOURCE_SKILL_REVIEW_ACTIONS,
  reviewImportContinuationRequestSchema,
  sourceCredentialClaimPolicySchema,
  sourceActionRequiredSchema,
  sourceSkillInputFieldSchema,
  sourceSkillInputOptionSchema,
  sourceSkillConnectionManifestSchema,
  sourceSkillManifestSchema,
  sourceSkillManifestsResponseSchema,
  type ReviewImportContinuationRequest,
  type SourceActionRequired,
  type SourceSkillManifest,
  type SourceSkillManifestsResponse,
} from "./source-skills.ts";

/** Protocol-visible problem codes emitted by the Rhizome HTTP API. */
export const PROBLEM_CODES = [
  "authentication_required",
  "grant_missing",
  "ingest_nonconformant",
  "import_review_invalid",
  "internal_error",
  "mime_required",
  "not_found",
  "not_implemented",
  "payload_too_large",
  "parser_unsupported",
  "rate_limited",
  "schema_violation",
  "source_action_required",
  "source_connection_failed",
  "writer_namespace_mismatch",
] as const;

export type ProblemCode = (typeof PROBLEM_CODES)[number];

export const problemDocumentSchema = {
  type: "object",
  required: ["type", "title", "status", "detail", "code"],
  properties: {
    type: { type: "string", format: "uri" },
    title: { type: "string", minLength: 1 },
    status: { type: "integer", minimum: 400, maximum: 599 },
    detail: { type: "string" },
    code: { enum: PROBLEM_CODES },
    required_action: sourceActionRequiredSchema,
    owner_action_required: { const: true },
    action: sourceActionRequiredSchema.properties.action,
  },
  additionalProperties: true,
} as const satisfies JSONSchema;

export type ProblemDocument = FromSchema<typeof problemDocumentSchema>;

export const OPERATION_KINDS = ["push", "pull", "agent"] as const;
export const OPERATION_STATUSES = ["queued", "running", "done", "failed", "aborted"] as const;

export const operationDocumentSchema = {
  type: "object",
  required: ["operation_id", "kind", "status", "request", "result", "error", "created_at"],
  properties: {
    operation_id: { type: "string", format: "uuid" },
    kind: { enum: OPERATION_KINDS },
    status: { enum: OPERATION_STATUSES },
    request: { type: "object" },
    result: { type: ["object", "null"] },
    review_digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    committed_at: { type: "string", format: "date-time" },
    error: { type: ["string", "null"] },
    created_at: { type: "string", format: "date-time" },
    finished_at: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

export type OperationDocument = FromSchema<typeof operationDocumentSchema>;

export const sourceCredentialDocumentSchema = {
  type: "object",
  required: ["credential", "skill_id", "connector_version", "status", "connected_at"],
  properties: {
    credential: { type: "string", pattern: SOURCE_CREDENTIAL_ID_PATTERN },
    skill_id: { type: "string", pattern: SOURCE_SKILL_ID_PATTERN },
    connector_version: { type: "string", minLength: 1 },
    status: { enum: ["active", "revoked"] },
    connected_at: { type: "string", format: "date-time" },
    revoked_at: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

export const createFileIngestionSourceRequestSchema = {
  type: "object",
  required: ["origin", "skill_id"],
  properties: {
    origin: originArtifactSchema.properties.uri,
    skill_id: { type: "string", pattern: SOURCE_SKILL_ID_PATTERN },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

/** Provider-neutral credential source shape; the installed skill validates `config`. */
export const createCredentialIngestionSourceRequestSchema = {
  type: "object",
  required: ["credential"],
  properties: {
    credential: { type: "string", pattern: SOURCE_CREDENTIAL_ID_PATTERN },
    config: { type: "object" },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

/** Provider-neutral public source shape; its installed skill validates and normalizes `config`. */
export const createPublicRemoteIngestionSourceRequestSchema = {
  type: "object",
  required: ["skill_id", "config"],
  properties: {
    skill_id: { type: "string", pattern: SOURCE_SKILL_ID_PATTERN },
    config: { type: "object" },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

export const createIngestionSourceRequestSchema = {
  oneOf: [
    createFileIngestionSourceRequestSchema,
    createCredentialIngestionSourceRequestSchema,
    createPublicRemoteIngestionSourceRequestSchema,
  ],
} as const satisfies JSONSchema;

export const fileIngestionSourceDocumentSchema = {
  type: "object",
  required: [
    "source",
    "kind",
    "skill_id",
    "connector_version",
    "parser",
    "parser_version",
    "origin",
    "created_at",
  ],
  properties: {
    source: { type: "string", pattern: SOURCE_ID_PATTERN },
    kind: { const: "origin" },
    skill_id: { type: "string", pattern: SOURCE_SKILL_ID_PATTERN },
    connector_version: { type: "string", minLength: 1 },
    parser: { type: "string", minLength: 1 },
    parser_version: { type: "string", minLength: 1 },
    origin: originArtifactSchema.properties.uri,
    created_at: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

/** Provider-neutral credential source document; parser/config semantics come from its skill. */
export const credentialIngestionSourceDocumentSchema = {
  type: "object",
  required: [
    "source",
    "kind",
    "skill_id",
    "connector_version",
    "parser",
    "parser_version",
    "config",
    "created_at",
  ],
  properties: {
    source: { type: "string", pattern: SOURCE_ID_PATTERN },
    kind: { const: "credential" },
    skill_id: { type: "string", pattern: SOURCE_SKILL_ID_PATTERN },
    connector_version: { type: "string", minLength: 1 },
    parser: { type: "string", minLength: 1 },
    parser_version: { type: "string", minLength: 1 },
    config: { type: "object" },
    created_at: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

/** Provider-neutral public source document; locator semantics remain private to its skill. */
export const publicRemoteIngestionSourceDocumentSchema = {
  type: "object",
  required: [
    "source",
    "kind",
    "skill_id",
    "connector_version",
    "parser",
    "parser_version",
    "config",
    "created_at",
  ],
  properties: {
    source: { type: "string", pattern: SOURCE_ID_PATTERN },
    kind: { const: "remote" },
    skill_id: { type: "string", pattern: SOURCE_SKILL_ID_PATTERN },
    connector_version: { type: "string", minLength: 1 },
    parser: { type: "string", minLength: 1 },
    parser_version: { type: "string", minLength: 1 },
    config: { type: "object" },
    created_at: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

export const ingestionSourceDocumentSchema = {
  oneOf: [
    fileIngestionSourceDocumentSchema,
    credentialIngestionSourceDocumentSchema,
    publicRemoteIngestionSourceDocumentSchema,
  ],
} as const satisfies JSONSchema;

export const createImportPreviewRequestSchema = {
  type: "object",
  required: ["source"],
  properties: {
    source: { type: "string", pattern: SOURCE_ID_PATTERN },
    continuation_token: reviewImportContinuationRequestSchema.properties.continuation_token,
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

export const pullVibeRequestSchema = {
  type: "object",
  properties: { dry_run: { type: "boolean", default: false } },
  additionalProperties: false,
} as const satisfies JSONSchema;

export type CreateIngestionSourceRequest = ContractValue<typeof createIngestionSourceRequestSchema>;
export type IngestionSourceDocument = ContractValue<typeof ingestionSourceDocumentSchema>;
export type SourceCredentialDocument = ContractValue<typeof sourceCredentialDocumentSchema>;
export type CreateImportPreviewRequest = ContractValue<typeof createImportPreviewRequestSchema>;
export type PullVibeRequest = ContractValue<typeof pullVibeRequestSchema>;

const vibeWritableProperties = {
  title: vibeSchema.properties.title,
  pull: vibeSchema.properties.pull,
  grants: vibeSchema.properties.grants,
} as const;

export const createVibeRequestSchema = {
  type: "object",
  required: ["title"],
  properties: vibeWritableProperties,
  additionalProperties: false,
} as const satisfies JSONSchema;

export const updateVibeRequestSchema = {
  type: "object",
  properties: vibeWritableProperties,
  additionalProperties: false,
} as const satisfies JSONSchema;

export const mediaObjectRefsRequestSchema = {
  type: "object",
  required: ["objects"],
  properties: {
    objects: {
      type: "array",
      minItems: 1,
      items: vibeSchema.properties.objects.items,
    },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

type RnetSchemaReferences = [
  typeof grantSchema,
  typeof ingestRecordSchema,
  typeof mediaElementSchema,
  typeof mediaObjectSchema,
  typeof vibeSchema,
];

type RawContractValue<Schema extends JSONSchema> = FromSchema<
  Schema,
  {
    keepDefaultedPropertiesOptional: true;
    references: RnetSchemaReferences;
  }
>;

type WithoutStringIndex<Value> = {
  [Key in keyof Value as string extends Key ? never : Key]: Value[Key];
};

/**
 * TypeScript cannot represent arbitrary regular-expression keys, but it can retain the
 * literal prefix of rNet's anchored `^prefix-[...]` extension patterns.
 */
type PatternPropertyKey<Pattern extends string> = Pattern extends `^${infer Prefix}[${string}`
  ? `${Prefix}${string}`
  : string;

type PatternPropertiesValue<Patterns extends Readonly<Record<string, JSONSchema>>> = {
  [Pattern in keyof Patterns & string as PatternPropertyKey<Pattern>]: RawContractValue<
    Patterns[Pattern]
  >;
};

/**
 * `json-schema-to-ts` deliberately widens `properties` + `patternProperties` to a
 * `[key: string]: unknown` index. Recursively replace only that lossy index with the
 * template-literal prefix derived from the schema; all named fields still come from
 * `FromSchema`.
 */
type RestorePatternPropertyKeys<Schema extends JSONSchema, Value> =
  Schema extends Readonly<{
    patternProperties: infer Patterns extends Readonly<Record<string, JSONSchema>>;
    additionalProperties: false;
  }>
    ? Value extends unknown
      ? WithoutStringIndex<Value> & PatternPropertiesValue<Patterns>
      : never
    : Schema extends Readonly<{
          type: "array";
          items: infer ItemSchema extends JSONSchema;
        }>
      ? Value extends Array<infer Item>
        ? Array<RestorePatternPropertyKeys<ItemSchema, Item>>
        : Value
      : Schema extends Readonly<{
            type: "object";
            properties: infer Properties extends Readonly<Record<string, JSONSchema>>;
          }>
        ? {
            [Key in keyof Value]: Key extends keyof Properties
              ? RestorePatternPropertyKeys<Properties[Key], Value[Key]>
              : Value[Key];
          }
        : Value;

type ContractValue<Schema extends JSONSchema> = RestorePatternPropertyKeys<
  Schema,
  RawContractValue<Schema>
>;

export type CreateVibeRequest = ContractValue<typeof createVibeRequestSchema>;
export type UpdateVibeRequest = ContractValue<typeof updateVibeRequestSchema>;
export type MediaObjectRefsRequest = ContractValue<typeof mediaObjectRefsRequestSchema>;

export const mediaElementUploadReferenceSchema = {
  type: "object",
  required: ["upload", "kind", "mime"],
  properties: {
    upload: { type: "string", minLength: 1 },
    kind: mediaElementSchema.properties.kind,
    mime: mediaElementSchema.properties.mime,
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

export const mediaElementReferenceInputSchema = {
  anyOf: [mediaObjectSchema.properties.elements.items, mediaElementUploadReferenceSchema],
} as const satisfies JSONSchema;

const createMediaObjectBaseProperties = {
  type: mediaObjectSchema.properties.type,
  elements: { type: "array", items: mediaElementReferenceInputSchema },
  keys: mediaObjectSchema.properties.keys,
} as const;

export const ownerCreateMediaObjectInputSchema = {
  type: "object",
  required: ["type", "source"],
  properties: {
    ...createMediaObjectBaseProperties,
    source: mediaObjectSchema.properties.source,
  },
  patternProperties: mediaObjectSchema.patternProperties,
  additionalProperties: false,
} as const satisfies JSONSchema;

export const clientCreateMediaObjectInputSchema = {
  type: "object",
  required: ["type"],
  properties: {
    ...createMediaObjectBaseProperties,
    properties: mediaObjectSchema.properties.source.properties.properties,
  },
  patternProperties: mediaObjectSchema.patternProperties,
  additionalProperties: false,
} as const satisfies JSONSchema;

export const ownerCreateMediaObjectsRequestSchema = {
  type: "object",
  required: ["objects"],
  properties: {
    vibe: vibeSchema.properties.uri,
    objects: {
      type: "array",
      minItems: 1,
      items: ownerCreateMediaObjectInputSchema,
    },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

export const clientCreateMediaObjectsRequestSchema = {
  type: "object",
  required: ["vibe", "objects"],
  properties: {
    vibe: vibeSchema.properties.uri,
    objects: {
      type: "array",
      minItems: 1,
      items: clientCreateMediaObjectInputSchema,
    },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

export const createMediaObjectsRequestSchema = {
  oneOf: [ownerCreateMediaObjectsRequestSchema, clientCreateMediaObjectsRequestSchema],
} as const satisfies JSONSchema;

export type OwnerCreateMediaObjectsRequest = ContractValue<
  typeof ownerCreateMediaObjectsRequestSchema
>;
export type ClientCreateMediaObjectsRequest = ContractValue<
  typeof clientCreateMediaObjectsRequestSchema
>;

export type CreateMediaObjectsRequest =
  OwnerCreateMediaObjectsRequest | ClientCreateMediaObjectsRequest;
export type CreateMediaObjectInput = CreateMediaObjectsRequest["objects"][number];

export const setMediaObjectUserRequestSchema = {
  type: "object",
  required: ["properties"],
  properties: {
    properties: mediaObjectSchema.properties.user.properties.properties,
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

export const setMediaObjectInferredRequestSchema = {
  type: "object",
  required: ["task", "entry"],
  properties: {
    task: { type: "string", pattern: TASK_PATTERN },
    entry: mediaObjectSchema.properties.inferred.additionalProperties,
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

export type SetMediaObjectUserRequest = ContractValue<typeof setMediaObjectUserRequestSchema>;
export type SetMediaObjectInferredRequest = ContractValue<
  typeof setMediaObjectInferredRequestSchema
>;

export const vibesResponseSchema = {
  type: "object",
  required: ["vibes"],
  properties: {
    vibes: {
      type: "array",
      items: { $ref: vibeSchema.$id },
    },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

export const mediaObjectsResponseSchema = {
  type: "object",
  required: ["mediaObjects"],
  properties: {
    mediaObjects: {
      type: "array",
      items: { $ref: mediaObjectSchema.$id },
    },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

export type VibesResponse = ContractValue<typeof vibesResponseSchema>;
export type MediaObjectsResponse = ContractValue<typeof mediaObjectsResponseSchema>;

/** Stable names used when registering these schemas as OpenAPI components. */
export const STORE_SCHEMA_COMPONENTS = {
  Problem: problemDocumentSchema,
  Operation: operationDocumentSchema,
  SourceCredential: sourceCredentialDocumentSchema,
  SourceSkillManifestsResponse: sourceSkillManifestsResponseSchema,
  SourceActionRequired: sourceActionRequiredSchema,
  ReviewImportContinuationRequest: reviewImportContinuationRequestSchema,
  IngestionSource: ingestionSourceDocumentSchema,
  CreateIngestionSourceRequest: createIngestionSourceRequestSchema,
  CreateImportPreviewRequest: createImportPreviewRequestSchema,
  PullVibeRequest: pullVibeRequestSchema,
  CreateVibeRequest: createVibeRequestSchema,
  UpdateVibeRequest: updateVibeRequestSchema,
  MediaObjectRefsRequest: mediaObjectRefsRequestSchema,
  CreateMediaObjectsRequest: createMediaObjectsRequestSchema,
  SetMediaObjectUserRequest: setMediaObjectUserRequestSchema,
  SetMediaObjectInferredRequest: setMediaObjectInferredRequestSchema,
  VibesResponse: vibesResponseSchema,
  MediaObjectsResponse: mediaObjectsResponseSchema,
} as const satisfies Readonly<Record<string, JSONSchema>>;
