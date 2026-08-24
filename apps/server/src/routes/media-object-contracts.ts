import {
  mediaElementSchema,
  mediaObjectSchema,
  validateMediaObjectProperties,
  vibeSchema,
  type MediaElement,
  type MediaObject,
  type ValidationIssue,
} from "@rnet/types";

import {
  jsonSchemaByActor,
  jsonSchemaValue,
  refineSchema,
  type ContractValue,
} from "./contracts.ts";

type MediaElementUploadReference = {
  upload: string;
  kind: MediaElement["kind"];
  mime: MediaElement["mime"];
};
type CreateMediaObjectBase = Pick<MediaObject, "keys" | "type"> & {
  elements?: (MediaObject["elements"][number] | MediaElementUploadReference)[];
};
type OwnerCreateMediaObjectInput = CreateMediaObjectBase & Pick<MediaObject, "source">;
type ClientCreateMediaObjectInput = CreateMediaObjectBase & {
  properties?: MediaObject["source"]["properties"];
};
interface OwnerCreateMediaObjectsRequest {
  vibe?: string;
  objects: OwnerCreateMediaObjectInput[];
}
interface ClientCreateMediaObjectsRequest {
  vibe: string;
  objects: ClientCreateMediaObjectInput[];
}

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

const OwnerCreateMediaObjectsRequestSchema = jsonSchemaValue<OwnerCreateMediaObjectsRequest>({
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

const ClientCreateMediaObjectsRequestSchema = jsonSchemaValue<ClientCreateMediaObjectsRequest>({
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

export const CreateMediaObjectsRequestSchema = refineSchema(
  jsonSchemaByActor({
    user: OwnerCreateMediaObjectsRequestSchema,
    client: ClientCreateMediaObjectsRequestSchema,
  }),
  (request) => {
    const issues: ValidationIssue[] = [];
    for (const [index, mediaObject] of request.objects.entries()) {
      const properties =
        "source" in mediaObject
          ? mediaObject.source.properties
          : "properties" in mediaObject
            ? (mediaObject.properties ?? {})
            : {};
      const validation = validateMediaObjectProperties(
        mediaObject.type,
        properties,
        `/objects/${index}/${"source" in mediaObject ? "source/" : ""}properties`,
      );
      if (!validation.ok) issues.push(...validation.issues);
    }
    return issues.length ? { ok: false, issues } : { ok: true, value: request };
  },
);

export type CreateMediaObjectsRequest = ContractValue<typeof CreateMediaObjectsRequestSchema>;
export type CreateMediaObjectInput = CreateMediaObjectsRequest["objects"][number];
