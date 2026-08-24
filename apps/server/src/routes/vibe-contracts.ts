import { vibeSchema } from "@rnet/types";

import { jsonSchema, type ContractValue } from "./contracts.ts";

const VibeWritableProperties = {
  title: vibeSchema.properties.title,
  pull: vibeSchema.properties.pull,
  grants: vibeSchema.properties.grants,
} as const;

export const CreateVibeRequestSchema = jsonSchema({
  type: "object",
  required: ["title"],
  properties: VibeWritableProperties,
  additionalProperties: false,
});

export const UpdateVibeRequestSchema = jsonSchema({
  type: "object",
  properties: VibeWritableProperties,
  additionalProperties: false,
});

export const MediaObjectRefsRequestSchema = jsonSchema({
  type: "object",
  required: ["objects"],
  properties: {
    objects: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: vibeSchema.properties.objects.items,
    },
  },
  additionalProperties: false,
});

export type CreateVibeRequest = ContractValue<typeof CreateVibeRequestSchema>;
export type UpdateVibeRequest = ContractValue<typeof UpdateVibeRequestSchema>;
export type MediaObjectRefsRequest = ContractValue<typeof MediaObjectRefsRequestSchema>;
