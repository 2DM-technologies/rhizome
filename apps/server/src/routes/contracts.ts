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

import { authenticationRequired, grantMissing, Problem, problemResponse } from "../errors.ts";
import { schemaProblem } from "../services/problems.ts";
import type { AppEnvironment } from "./types.ts";

export type JsonSchemaDocument = JSONSchema;

export interface ContractSchema<Value> {
  readonly document: JsonSchemaDocument;
  validate(value: unknown): ValidationResult<Value>;
}

type ContractResponses = Readonly<Record<number, ContractSchema<unknown>>>;
type ContractRequest = Readonly<{
  json?: ContractSchema<object>;
  multipart?: ContractSchema<object>;
  param?: ContractSchema<object>;
}>;

export type RouteContract<
  Request extends ContractRequest | undefined,
  Responses extends ContractResponses,
> = {
  readonly auth?: "authenticated" | "user";
  readonly responses: Responses;
} & (Request extends ContractRequest
  ? { readonly request: Request }
  : { readonly request?: never });

type ContractValue<Schema> = Schema extends ContractSchema<infer Value> ? Value : never;

type ContractTargets<Request extends ContractRequest> = (Request extends { json: infer Schema }
  ? { json: ContractValue<Schema> }
  : object) &
  (Request extends { multipart: infer Schema }
    ? {
        form: {
          metadata: ContractValue<Schema>;
          uploads: ReadonlyMap<string, File>;
        };
      }
    : object) &
  (Request extends { param: infer Schema } ? { param: ContractValue<Schema> } : object);

type ContractInput<Request extends ContractRequest | undefined> = Request extends ContractRequest
  ? Input & {
      in: ContractTargets<Request>;
      out: ContractTargets<Request>;
    }
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

export function rnetDocument<Name extends SchemaName>(
  name: Name,
): ContractSchema<SchemaTypes[Name]> {
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

type Collection<Key extends string, Value> = { [Property in Key]: Value[] };

export function collectionOf<Value, const Key extends string = "items">(
  item: ContractSchema<Value>,
  key: Key = "items" as Key,
): ContractSchema<Collection<Key, Value>> {
  const id = typeof item.document === "object" ? item.document.$id : undefined;
  if (typeof id !== "string") throw new Error("Collection item schemas must have an $id");
  const collection = jsonSchema({
    type: "object",
    required: [key],
    properties: { [key]: { type: "array", items: { $ref: id } } },
    additionalProperties: false,
  });
  return {
    document: collection.document,
    validate(value) {
      const envelope = collection.validate(value);
      if (!envelope.ok) return envelope;
      const entries = (envelope.value as Record<Key, unknown[]>)[key];
      const issues = entries.flatMap((entry, index) => {
        const validation = item.validate(entry);
        return validation.ok
          ? []
          : validation.issues.map((issue) => ({
              ...issue,
              instancePath: `/${key}/${index}${issue.instancePath}`,
            }));
      });
      return issues.length
        ? { ok: false, issues }
        : { ok: true, value: envelope.value as Collection<Key, Value> };
    },
  };
}

export const ProblemSchema = jsonSchema({
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

export const RecordIdParamsSchema = jsonSchema({
  type: "object",
  required: ["id"],
  properties: {
    id: {
      type: "string",
      pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    },
  },
  additionalProperties: false,
});

export function rnetRoute<
  Request extends ContractRequest | undefined,
  const Responses extends ContractResponses,
>(
  contract: RouteContract<Request, Responses>,
): MiddlewareHandler<AppEnvironment, string, ContractInput<Request>> {
  return async (context, next) => {
    try {
      const actor = context.get("actor");
      if (contract.auth && actor.kind === "public") {
        throw authenticationRequired();
      }
      if (contract.auth === "user" && actor.kind !== "user") throw grantMissing("owner");
      if (contract.request?.param) {
        const validation = contract.request.param.validate(context.req.param());
        if (!validation.ok) throw schemaProblem(validation.issues);
        context.req.addValidatedData("param", validation.value);
      }
      if (contract.request?.json) {
        const body = await context.req.json().catch(() => {
          throw new Problem(
            422,
            "schema_violation",
            "Invalid JSON",
            "The request body must be JSON",
          );
        });
        const validation = contract.request.json.validate(body);
        if (!validation.ok) throw schemaProblem(validation.issues);
        context.req.addValidatedData("json", validation.value);
      }
      if (contract.request?.multipart) {
        const form = await context.req.formData().catch(() => {
          throw new Problem(
            422,
            "schema_violation",
            "Invalid multipart body",
            "The request body must be multipart/form-data",
          );
        });
        if (form.getAll("metadata").length !== 1) {
          throw schemaProblem([{ instancePath: "/metadata", message: "must appear exactly once" }]);
        }
        const metadataPart = form.get("metadata");
        if (typeof metadataPart !== "string") {
          throw schemaProblem([
            { instancePath: "/metadata", message: "must be a JSON string form field" },
          ]);
        }
        let metadata: unknown;
        try {
          metadata = JSON.parse(metadataPart) as unknown;
        } catch {
          throw schemaProblem([{ instancePath: "/metadata", message: "must contain valid JSON" }]);
        }
        const validation = contract.request.multipart.validate(metadata);
        if (!validation.ok) throw schemaProblem(validation.issues, "/metadata");

        const uploads = new Map<string, File>();
        for (const [name, value] of form.entries()) {
          if (name === "metadata") continue;
          if (typeof value === "string") {
            throw schemaProblem([
              { instancePath: `/${name}`, message: "must be a binary file part" },
            ]);
          }
          if (uploads.has(name)) {
            throw schemaProblem([{ instancePath: `/${name}`, message: "must be unique" }]);
          }
          uploads.set(name, value as File);
        }
        context.req.addValidatedData("form", { metadata: validation.value, uploads });
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
