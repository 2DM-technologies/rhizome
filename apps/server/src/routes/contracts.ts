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
import type { Context, Input, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { Problem } from "../errors.ts";
import { schemaProblem } from "../services/problems.ts";
import type { AppEnvironment } from "./types.ts";

export type JsonSchemaDocument = Readonly<Record<string, unknown>>;

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

type SchemaValue<Schema> = Schema extends ContractSchema<infer Value> ? Value : never;

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

export function jsonSchema<Value>(document: JsonSchemaDocument): ContractSchema<Value> {
  const validate = ajv.compile<Value>(document);
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
  const id = item.document.$id;
  if (typeof id !== "string") throw new Error("Collection item schemas must have an $id");
  const collection = jsonSchema<{ items: Value[] }>({
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
      return issues.length ? { ok: false, issues } : envelope;
    },
  };
}

export function defineRoute<
  RequestBody extends object | undefined,
  const Responses extends ContractResponses,
>(contract: RouteContract<RequestBody, Responses>): RouteContract<RequestBody, Responses> {
  return contract;
}

export function validateJsonRequest<RequestBody extends object>(
  contract: RouteContract<RequestBody, ContractResponses>,
): MiddlewareHandler<AppEnvironment, string, JsonInput<RequestBody>> {
  return async (context, next) => {
    const body = await context.req.json().catch(() => {
      throw new Problem(422, "schema_violation", "Invalid JSON", "The request body must be JSON");
    });
    const validation = contract.request.json.validate(body);
    if (!validation.ok) throw schemaProblem(validation.issues);
    context.req.addValidatedData("json", validation.value);
    await next();
  };
}

export function jsonResponse<
  Responses extends ContractResponses,
  Status extends keyof Responses & ContentfulStatusCode,
>(
  context: Context<AppEnvironment>,
  contract: { readonly responses: Responses },
  status: Status,
  value: SchemaValue<Responses[Status]>,
): Response {
  const schema = contract.responses[status];
  if (!schema) throw new Error(`No response schema declared for status ${status}`);
  const validation = schema.validate(value);
  if (!validation.ok) {
    throw new Error(`Route produced an invalid ${status} response: ${JSON.stringify(validation.issues)}`);
  }
  return context.json(validation.value as never, status);
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
