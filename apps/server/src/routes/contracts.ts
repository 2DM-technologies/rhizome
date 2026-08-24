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

import type { Actor, AppVariables, AuthenticatedActor, ClientActor, UserActor } from "../auth.ts";
import { authenticationRequired, grantMissing, Problem, problemResponse } from "../errors.ts";
import { schemaProblem } from "../services/problems.ts";

export type JsonSchemaDocument = JSONSchema;

export interface ContractSchema<Value> {
  readonly document: JsonSchemaDocument;
  validate(value: unknown, actor?: Actor): ValidationResult<Value>;
}

export interface UnvalidatedContractResponse {
  readonly contentType?: string;
  readonly description: string;
  readonly document?: JsonSchemaDocument;
}

type ContractResponse = ContractSchema<unknown> | UnvalidatedContractResponse | null;
type ContractResponses = Readonly<Record<number, ContractResponse>>;
type ContractRequest = Readonly<{
  binary?: Readonly<{
    contentType: string;
    document: JsonSchemaDocument;
  }>;
  header?: ContractSchema<object>;
  json?: ContractSchema<object>;
  multipart?: ContractSchema<object>;
  param?: ContractSchema<object>;
}>;

export type RouteContract<
  Auth extends RouteAuth | undefined,
  Request extends ContractRequest | undefined,
  Responses extends ContractResponses,
> = {
  readonly operationId: string;
  readonly auth?: Auth;
  readonly responses: Responses;
} & (Request extends ContractRequest
  ? { readonly request: Request }
  : { readonly request?: never });

export type ContractValue<Schema> = Schema extends ContractSchema<infer Value> ? Value : never;

type ObjectContractValue<
  Properties extends Readonly<Record<string, ContractSchema<unknown>>>,
  Required extends readonly (keyof Properties)[],
> = { [Key in Required[number]]: ContractValue<Properties[Key]> } & {
  [Key in Exclude<keyof Properties, Required[number]>]?: ContractValue<Properties[Key]>;
};

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
  (Request extends { header: infer Schema } ? { header: ContractValue<Schema> } : object) &
  (Request extends { param: infer Schema } ? { param: ContractValue<Schema> } : object);

type ContractInput<Request extends ContractRequest | undefined> = Request extends ContractRequest
  ? Input & {
      in: ContractTargets<Request>;
      out: ContractTargets<Request>;
    }
  : Input;

export type RouteAuth = "user" | "client" | "user_or_client";

type RouteActor<Auth extends RouteAuth | undefined> = Auth extends "user"
  ? UserActor
  : Auth extends "client"
    ? ClientActor
    : Auth extends "user_or_client"
      ? AuthenticatedActor
      : Actor;

type RouteEnvironment<Auth extends RouteAuth | undefined> = {
  Variables: Omit<AppVariables, "actor"> & { actor: RouteActor<Auth> };
};

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

export const RNET_DOCUMENTS = {
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
  return compileJsonSchema(document);
}

function compileJsonSchema(document: JsonSchemaDocument): ContractSchema<unknown> {
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

export function jsonSchemaValue<Value>(document: JsonSchemaDocument): ContractSchema<Value> {
  return compileJsonSchema(document) as ContractSchema<Value>;
}

export function jsonObjectSchema<
  const Properties extends Readonly<Record<string, ContractSchema<unknown>>>,
  const Required extends readonly (keyof Properties)[],
>(
  properties: Properties,
  required: Required,
): ContractSchema<ObjectContractValue<Properties, Required>> {
  const document: JsonSchemaDocument = {
    type: "object",
    required: required as readonly string[],
    properties: Object.fromEntries(
      Object.entries(properties).map(([name, property]) => [name, property.document]),
    ),
    additionalProperties: false,
  };
  return compileJsonSchema(document) as ContractSchema<ObjectContractValue<Properties, Required>>;
}

export function transformSchema<Value>(
  schema: ContractSchema<Value>,
  transform: (value: unknown) => unknown,
): ContractSchema<Value> {
  return {
    document: schema.document,
    validate(value, actor) {
      return schema.validate(transform(value), actor);
    },
  };
}

export function jsonSchemaByActor<UserValue extends object, ClientValue extends object>({
  user,
  client,
}: {
  user: ContractSchema<UserValue>;
  client: ContractSchema<ClientValue>;
}): ContractSchema<UserValue | ClientValue> {
  const union = jsonSchema({ oneOf: [user.document, client.document] });
  return {
    document: union.document,
    validate(value, actor) {
      if (actor?.kind === "user") return user.validate(value);
      if (actor?.kind === "client") return client.validate(value);
      return union.validate(value) as ValidationResult<UserValue | ClientValue>;
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

export const BinaryRequest = {
  contentType: "*/*",
  document: { type: "string", format: "binary" },
} as const;

export function binaryResponse(
  contentType = "application/octet-stream",
): UnvalidatedContractResponse {
  return {
    contentType,
    description: "Binary content",
    document: { type: "string", format: "binary" },
  };
}

type OpenApiRouteContract = RouteContract<
  RouteAuth | undefined,
  ContractRequest | undefined,
  ContractResponses
>;

const RNET_ROUTE_CONTRACT = Symbol("rnetRouteContract");

type ContractMiddleware = ((...args: never[]) => unknown) & {
  readonly [RNET_ROUTE_CONTRACT]: OpenApiRouteContract;
};

export function routeContract(handler: unknown): OpenApiRouteContract | undefined {
  if (typeof handler !== "function") return undefined;
  return (handler as Partial<ContractMiddleware>)[RNET_ROUTE_CONTRACT];
}

export function rnetRoute<
  Request extends ContractRequest | undefined,
  const Responses extends ContractResponses,
  const Auth extends RouteAuth | undefined = undefined,
>(
  contract: RouteContract<Auth, Request, Responses>,
): MiddlewareHandler<RouteEnvironment<Auth>, string, ContractInput<Request>> {
  const middleware: MiddlewareHandler<
    RouteEnvironment<Auth>,
    string,
    ContractInput<Request>
  > = async (context, next) => {
    try {
      const actor = context.get("actor");
      if (contract.auth && actor.kind === "public") throw authenticationRequired();
      if (contract.auth && contract.auth !== "user_or_client" && actor.kind !== contract.auth) {
        throw grantMissing(contract.auth === "user" ? "owner" : "client");
      }
      if (contract.request?.param) {
        const validation = contract.request.param.validate(context.req.param(), actor);
        if (!validation.ok) throw schemaProblem(validation.issues);
        context.req.addValidatedData("param", validation.value);
      }
      if (contract.request?.header) {
        const headerValues = contractHeaderValues(context.req.header(), contract.request.header);
        const validation = contract.request.header.validate(headerValues, actor);
        if (!validation.ok) throw schemaProblem(validation.issues);
        context.req.addValidatedData("header", validation.value);
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
        const validation = contract.request.json.validate(body, actor);
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
        const validation = contract.request.multipart.validate(metadata, actor);
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
    if (!schema || !("validate" in schema)) return;
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
  Object.defineProperty(middleware, RNET_ROUTE_CONTRACT, {
    value: contract as OpenApiRouteContract,
  });
  return middleware;
}

function contractHeaderValues(
  requestHeaders: Record<string, string>,
  schema: ContractSchema<object>,
): Record<string, string> {
  if (typeof schema.document !== "object") return {};
  const properties = schema.document.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return {};
  const values: Record<string, string> = {};
  for (const name of Object.keys(properties)) {
    const value = requestHeaders[name.toLowerCase()];
    if (value !== undefined) values[name] = value;
  }
  return values;
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
