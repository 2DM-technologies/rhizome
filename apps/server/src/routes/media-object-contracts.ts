import { mediaElementSchema, mediaObjectSchema, vibeSchema } from "@rnet/types";

import { jsonSchema, jsonSchemaByActor, type ContractValue } from "./contracts.ts";

const MediaElementUploadReferenceSchema = {
  type: "object",
  required: ["upload", "kind", "mime"],
  properties: {
    upload: { type: "string", minLength: 1 },
    kind: mediaElementSchema.properties.kind,
    mime: mediaElementSchema.properties.mime,
  },
  additionalProperties: false,
} as const;

const MediaElementReferenceInputSchema = {
  anyOf: [mediaObjectSchema.properties.elements.items, MediaElementUploadReferenceSchema],
} as const;

const CreateMediaObjectBaseProperties = {
  type: mediaObjectSchema.properties.type,
  elements: { type: "array", items: MediaElementReferenceInputSchema },
  keys: mediaObjectSchema.properties.keys,
} as const;

const OwnerCreateMediaObjectInputSchema = {
  type: "object",
  required: ["type", "source"],
  properties: {
    ...CreateMediaObjectBaseProperties,
    source: mediaObjectSchema.properties.source,
  },
  patternProperties: { "^x-": {} },
  additionalProperties: false,
} as const;

const ClientCreateMediaObjectInputSchema = {
  type: "object",
  required: ["type"],
  properties: {
    ...CreateMediaObjectBaseProperties,
    properties: mediaObjectSchema.properties.source.properties.properties,
  },
  patternProperties: { "^x-": {} },
  additionalProperties: false,
} as const;

const OwnerCreateMediaObjectsRequestSchema = jsonSchema({
  type: "object",
  required: ["objects"],
  properties: {
    vibe: vibeSchema.properties.uri,
    objects: {
      type: "array",
      minItems: 1,
      items: OwnerCreateMediaObjectInputSchema,
    },
  },
  additionalProperties: false,
});

const ClientCreateMediaObjectsRequestSchema = jsonSchema({
  type: "object",
  required: ["vibe", "objects"],
  properties: {
    vibe: vibeSchema.properties.uri,
    objects: {
      type: "array",
      minItems: 1,
      items: ClientCreateMediaObjectInputSchema,
    },
  },
  additionalProperties: false,
});

export const CreateMediaObjectsRequestSchema = jsonSchemaByActor({
  user: OwnerCreateMediaObjectsRequestSchema,
  client: ClientCreateMediaObjectsRequestSchema,
});

export type CreateMediaObjectsRequest = ContractValue<typeof CreateMediaObjectsRequestSchema>;
export type CreateMediaObjectInput = CreateMediaObjectsRequest["objects"][number];
