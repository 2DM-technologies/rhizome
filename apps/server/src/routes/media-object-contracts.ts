import { mediaElementSchema, mediaObjectSchema, vibeSchema } from "@rnet/types";

import { jsonSchema, jsonSchemaByActor, type ContractValue, type Namespaced } from "./contracts.ts";

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
export type CreateMediaObjectInput = Namespaced<CreateMediaObjectsRequest["objects"][number]>;

/**
 * Where a create request carries the properties to validate against the registered type
 * vocabulary, and the JSON pointer to report against. Owners supply `source.properties`;
 * clients supply a bare `properties` and the store authors the surrounding source block.
 * Lives here so the two request shapes are only ever interpreted next to their schemas.
 */
export function mediaObjectPropertiesInput(input: CreateMediaObjectInput): {
  properties: Record<string, unknown>;
  pointer: string;
} {
  if ("source" in input) {
    return { properties: input.source.properties, pointer: "source/properties" };
  }
  return { properties: input.properties ?? {}, pointer: "properties" };
}
