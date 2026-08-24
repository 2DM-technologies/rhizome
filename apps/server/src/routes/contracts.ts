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
  UUIDV7_PATTERN,
  type SchemaName,
  type SchemaTypes,
  type ValidationIssue,
  type ValidationResult,
} from "@rnet/types";
import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { Handler, Input, MiddlewareHandler } from "hono";
import { validator } from "hono/validator";
import type { FromSchema, JSONSchema } from "json-schema-to-ts";

import type { Actor, AppVariables, AuthenticatedActor, ClientActor, UserActor } from "../auth.ts";
import { authenticationRequired, grantMissing, problemDocumentSchema } from "../errors.ts";
import { schemaProblem } from "../services/problems.ts";

export type JsonSchemaDocument = JSONSchema;

export interface ContractSchema<Value> {
  readonly document: JsonSchemaDocument;
  validate(value: unknown, actor?: Actor): ValidationResult<Value>;
}

export interface ObjectContractSchema<Value extends object> extends ContractSchema<Value> {
  readonly propertyNames: readonly string[];
}

export interface UnvalidatedContractResponse {
  readonly contentType?: string;
  readonly description: string;
  readonly document?: JsonSchemaDocument;
}

type ContractResponse = ContractSchema<unknown> | UnvalidatedContractResponse | null;
export type ContractResponses = Readonly<Record<number, ContractResponse>>;
export type ContractRequest = Readonly<{
  binary?: Readonly<{
    contentType: string;
    document: JsonSchemaDocument;
  }>;
  header?: ObjectContractSchema<object>;
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

export type ContractInput<Request extends ContractRequest | undefined> =
  Request extends ContractRequest
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

export type RouteEnvironment<Auth extends RouteAuth | undefined> = {
  Variables: Omit<AppVariables, "actor"> & { actor: RouteActor<Auth> };
};

export type RhizomeRouteHandler<
  Auth extends RouteAuth | undefined,
  Request extends ContractRequest | undefined,
  Path extends string,
> = Handler<RouteEnvironment<Auth>, Path, ContractInput<Request>>;

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
): ObjectContractSchema<ObjectContractValue<Properties, Required>> {
  const document: JsonSchemaDocument = {
    type: "object",
    required: required as readonly string[],
    properties: Object.fromEntries(
      Object.entries(properties).map(([name, property]) => [name, property.document]),
    ),
    additionalProperties: false,
  };
  return {
    ...compileJsonSchema(document),
    propertyNames: Object.keys(properties),
  } as ObjectContractSchema<ObjectContractValue<Properties, Required>>;
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

export const ProblemSchema = jsonSchema(problemDocumentSchema);

export const RecordIdParamsSchema = jsonSchema({
  type: "object",
  required: ["id"],
  properties: {
    id: {
      type: "string",
      pattern: UUIDV7_PATTERN,
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

export type OpenApiRouteContract = RouteContract<
  RouteAuth | undefined,
  ContractRequest | undefined,
  ContractResponses
>;

export function rhizomeRoute<
  Request extends ContractRequest | undefined,
  const Responses extends ContractResponses,
  const Auth extends RouteAuth | undefined = undefined,
>(contract: RouteContract<Auth, Request, Responses>): MiddlewareHandler<RouteEnvironment<Auth>>[] {
  const middleware: MiddlewareHandler<RouteEnvironment<Auth>>[] = [];

  if (contract.auth) {
    middleware.push(async (context, next) => {
      const actor = context.get("actor");
      if (actor.kind === "public") throw authenticationRequired();
      if (contract.auth !== "user_or_client" && actor.kind !== contract.auth) {
        throw grantMissing(contract.auth === "user" ? "owner" : "client");
      }
      await next();
    });
  }

  const paramSchema = contract.request?.param;
  if (paramSchema) {
    middleware.push(
      validator("param", (params, context) =>
        validatedValue(paramSchema, params, context.get("actor")),
      ),
    );
  }

  const headerSchema = contract.request?.header;
  if (headerSchema) {
    middleware.push(
      validator("header", (headers, context) =>
        validatedValue(
          headerSchema,
          pickContractHeaders(headers, headerSchema.propertyNames),
          context.get("actor"),
        ),
      ),
    );
  }

  const jsonRequestSchema = contract.request?.json;
  if (jsonRequestSchema) {
    middleware.push(
      validator("json", (body, context) =>
        validatedValue(jsonRequestSchema, body, context.get("actor")),
      ),
    );
  }

  const multipartSchema = contract.request?.multipart;
  if (multipartSchema) {
    middleware.push(
      validator("form", (form, context) => {
        const metadataPart = form.metadata;
        if (metadataPart === undefined || Array.isArray(metadataPart)) {
          throw schemaProblem([{ instancePath: "/metadata", message: "must appear exactly once" }]);
        }
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
        const validatedMetadata = validatedValue(
          multipartSchema,
          metadata,
          context.get("actor"),
          "/metadata",
        );

        const uploads = new Map<string, File>();
        for (const [name, value] of Object.entries(form)) {
          if (name === "metadata") continue;
          if (Array.isArray(value)) {
            throw schemaProblem([{ instancePath: `/${name}`, message: "must be unique" }]);
          }
          if (typeof value === "string") {
            throw schemaProblem([
              { instancePath: `/${name}`, message: "must be a binary file part" },
            ]);
          }
          uploads.set(name, value);
        }
        return { metadata: validatedMetadata, uploads };
      }),
    );
  }

  middleware.push(async (context, next) => {
    await next();
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
  });

  return middleware;
}

function validatedValue<Value>(
  schema: ContractSchema<Value>,
  value: unknown,
  actor: Actor,
  instancePath?: string,
): Value {
  const validation = schema.validate(value, actor);
  if (!validation.ok) throw schemaProblem(validation.issues, instancePath);
  return validation.value;
}

function pickContractHeaders(
  requestHeaders: Record<string, string>,
  headerNames: readonly string[],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of headerNames) {
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
