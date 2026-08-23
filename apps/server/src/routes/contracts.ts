import {
  grantSchema,
  ingestRecordSchema,
  mediaElementSchema,
  mediaObjectSchema,
  originArtifactSchema,
  trackPropertiesSchema,
  transactionPropertiesSchema,
  validateMediaObject,
  validateSchema,
  vibeSchema,
  type SchemaName,
  type SchemaTypes,
  type ValidationIssue,
  type ValidationResult,
} from "@rnet/types";
import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { Input, MiddlewareHandler } from "hono";
import type { FromSchema, JSONSchema } from "json-schema-to-ts";

import { Problem, problemResponse } from "../errors.ts";
import { schemaProblem } from "../services/problems.ts";
import type { AppEnvironment } from "./types.ts";

export type JsonSchemaDocument = JSONSchema;

export interface ContractSchema<Value> {
  readonly document: JsonSchemaDocument;
  validate(value: unknown): ValidationResult<Value>;
}

type ContractResponses = Readonly<Record<number, ContractSchema<unknown>>>;

export type RouteContract<
  RequestBody extends object | undefined,
  Responses extends ContractResponses,
> = { readonly responses: Responses } & (RequestBody extends object
  ? { readonly request: { readonly json: ContractSchema<RequestBody> } }
  : { readonly request?: never });

type JsonInput<Value extends object> = Input & {
  in: { json: Value };
  out: { json: Value };
};

type ContractInput<RequestBody extends object | undefined> = RequestBody extends object
  ? JsonInput<RequestBody>
  : Input;

type RnetSchemaReferences = [
  typeof grantSchema,
  typeof ingestRecordSchema,
  typeof mediaElementSchema,
  typeof mediaObjectSchema,
  typeof originArtifactSchema,
  typeof trackPropertiesSchema,
  typeof transactionPropertiesSchema,
  typeof vibeSchema,
];

type JsonSchemaValue<Schema extends JSONSchema> = FromSchema<
  Schema,
  { keepDefaultedPropertiesOptional: true; references: RnetSchemaReferences }
>;

const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strict: true,
  validateFormats: true,
});
addFormats(ajv);

const RNET_DOCUMENTS = {
  grant: grantSchema,
  "ingest-record": ingestRecordSchema,
  "media-element": mediaElementSchema,
  "media-object": mediaObjectSchema,
  "origin-artifact": originArtifactSchema,
  track: trackPropertiesSchema,
  transaction: transactionPropertiesSchema,
  vibe: vibeSchema,
} satisfies Record<SchemaName, JsonSchemaDocument>;

for (const document of Object.values(RNET_DOCUMENTS)) ajv.addSchema(document);

export function jsonSchema<const Schema extends JSONSchema>(
  document: Schema,
): ContractSchema<JsonSchemaValue<Schema>>;
export function jsonSchema(document: JSONSchema): ContractSchema<unknown> {
  const validate = ajv.compile(document);
  return {
    document,
    validate(value) {
      return validate(value)
        ? { ok: true, value }
        : { ok: false, issues: validationIssues(validate.errors) };
    },
  };
}

export function rnetDocument<Name extends SchemaName>(name: Name): ContractSchema<SchemaTypes[Name]> {
  return {
    document: RNET_DOCUMENTS[name],
    validate(value) {
      if (name === "media-object") {
        return validateMediaObject(value) as ValidationResult<SchemaTypes[Name]>;
      }
      return validateSchema(name, value);
    },
  };
}

export function collectionOf<Value>(item: ContractSchema<Value>): ContractSchema<{ items: Value[] }> {
  const id = typeof item.document === "object" ? item.document.$id : undefined;
  if (typeof id !== "string") throw new Error("Collection item schemas must have an $id");
  const collection = jsonSchema({
    type: "object",
    required: ["items"],
    properties: { items: { type: "array", items: { $ref: id } } },
    additionalProperties: false,
  });
  return {
    document: collection.document,
    validate(value) {
      const envelope = collection.validate(value);
      if (!envelope.ok) return envelope;
      const issues = envelope.value.items.flatMap((entry, index) => {
        const validation = item.validate(entry);
        return validation.ok
          ? []
          : validation.issues.map((issue) => ({
              ...issue,
              instancePath: `/items/${index}${issue.instancePath}`,
            }));
      });
      return issues.length
        ? { ok: false, issues }
        : { ok: true, value: envelope.value as { items: Value[] } };
    },
  };
}

export const problemSchema = jsonSchema({
  type: "object",
  required: ["type", "title", "status", "detail", "code"],
  properties: {
    type: { type: "string", format: "uri" },
    title: { type: "string", minLength: 1 },
    status: { type: "integer", minimum: 400, maximum: 599 },
    detail: { type: "string" },
    code: { type: "string", minLength: 1 },
  },
  additionalProperties: true,
});

export function rnetRoute<
  RequestBody extends object | undefined,
  const Responses extends ContractResponses,
>(
  contract: RouteContract<RequestBody, Responses>,
): MiddlewareHandler<AppEnvironment, string, ContractInput<RequestBody>> {
  return async (context, next) => {
    try {
      if (contract.request) {
        const body = await context.req.json().catch(() => {
          throw new Problem(422, "schema_violation", "Invalid JSON", "The request body must be JSON");
        });
        const validation = contract.request.json.validate(body);
        if (!validation.ok) throw schemaProblem(validation.issues);
        context.req.addValidatedData("json", validation.value);
      }
      await next();
    } catch (error) {
      if (!(error instanceof Problem)) throw error;
      context.res = problemResponse(context, error);
    }

    const schema = contract.responses[context.res.status];
    if (!schema) return;
    const value = await context.res
      .clone()
      .json()
      .catch(() => {
        throw new Error(`Route produced a non-JSON ${context.res.status} response`);
      });
    const validation = schema.validate(value);
    if (!validation.ok) {
      throw new Error(
        `Route produced an invalid ${context.res.status} response: ${JSON.stringify(validation.issues)}`,
      );
    }
  };
}

function validationIssues(errors: ErrorObject[] | null | undefined): ValidationIssue[] {
  return (errors ?? []).map((error) => ({
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message ?? "schema violation",
    params: error.params as Record<string, unknown>,
  }));
}
