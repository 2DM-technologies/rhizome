import type { JSONSchema } from "json-schema-to-ts";

import { STORE_SCHEMA_COMPONENTS } from "@rhizome/store-contract";

import {
  RNET_DOCUMENTS,
  type ContractResponseWithHeaders,
  type ContractSchema,
  type OpenApiRouteContract,
  type UnvalidatedContractResponse,
} from "./routes/contracts.ts";
import type { RegisteredRhizomeRoute } from "./routes/rhizome-router.ts";

type JsonObject = Record<string, unknown>;
type OpenApiSchema = boolean | JsonObject;

const COMPONENT_NAMES = {
  grant: "Grant",
  "ingest-record": "IngestRecord",
  "media-element": "MediaElement",
  "media-object": "MediaObject",
  "origin-artifact": "OriginArtifact",
  track: "TrackProperties",
  tweet: "TweetProperties",
  transaction: "TransactionProperties",
  vibe: "Vibe",
} as const;

const RNET_SCHEMA_COMPONENTS = Object.fromEntries(
  Object.entries(RNET_DOCUMENTS).map(([name, document]) => [
    COMPONENT_NAMES[name as keyof typeof COMPONENT_NAMES],
    localizeSchemaForOpenApi(document),
  ]),
);

const STORE_SCHEMA_COMPONENT_ENTRIES = Object.entries(STORE_SCHEMA_COMPONENTS).map(
  ([name, document]) => {
    if (typeof document !== "object" || document === null) {
      throw new Error(`Shared OpenAPI component ${name} must be an object schema`);
    }
    return [name, document] as const;
  },
);

const STORE_COMPONENT_FOR_SCHEMA = new Map<object, string>(
  STORE_SCHEMA_COMPONENT_ENTRIES.map(([name, document]) => [document, name]),
);

const LOCALIZED_STORE_SCHEMA_COMPONENTS = Object.fromEntries(
  STORE_SCHEMA_COMPONENT_ENTRIES.map(([name, document]) => [
    name,
    localizeSchemaForOpenApi(document),
  ]),
);

export function createOpenApiDocument(routes: readonly RegisteredRhizomeRoute[]) {
  const paths: Record<string, Record<string, unknown>> = {};
  const operationIds = new Set<string>();

  for (const route of routes) {
    const contract = route.contract;
    if (operationIds.has(contract.operationId)) {
      throw new Error(`Duplicate OpenAPI operationId: ${contract.operationId}`);
    }
    operationIds.add(contract.operationId);

    const path = route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    const method = route.method.toLowerCase();
    const pathItem = (paths[path] ??= {});
    if (pathItem[method]) throw new Error(`Duplicate OpenAPI route: ${route.method} ${path}`);
    pathItem[method] = operation(contract);
  }

  return {
    openapi: "3.1.0",
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    info: {
      title: "Rhizome rNet API",
      version: "0.1.0",
      description: "The rNet-compatible API exposed by the Rhizome store.",
    },
    servers: [{ url: "/", description: "Current Rhizome store" }],
    // Every route accepts an identity when supplied, while public-readable routes also
    // work anonymously. Routes with a required `auth` contract override this below.
    security: [{ BearerAuth: [] }, {}],
    paths,
    components: {
      securitySchemes: {
        BearerAuth: { type: "http", scheme: "bearer" },
      },
      schemas: {
        ...RNET_SCHEMA_COMPONENTS,
        ...LOCALIZED_STORE_SCHEMA_COMPONENTS,
      },
    },
  } as const;
}

function operation(contract: OpenApiRouteContract): JsonObject {
  const parameters = [
    ...parametersFor(contract.request?.param, "path"),
    ...parametersFor(contract.request?.header, "header"),
  ];
  const requestBody = contract.request ? requestBodyFor(contract.request) : undefined;
  const responses: Record<string, unknown> = {};

  for (const [status, response] of Object.entries(contract.responses)) {
    responses[status] = responseFor(Number(status), response);
  }
  for (const status of [413, 500] as const) {
    responses[status] ??= problemResponseFor(status);
  }
  responses.default = {
    description: "Problem response",
    content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
  };

  return {
    operationId: contract.operationId,
    tags: [tagForOperation(contract.operationId)],
    ...(contract.auth
      ? {
          security: [{ BearerAuth: [] }],
          "x-rhizome-auth": contract.auth,
        }
      : {}),
    ...(parameters.length ? { parameters } : {}),
    ...(requestBody ? { requestBody } : {}),
    responses,
  };
}

function problemResponseFor(status: number): JsonObject {
  return {
    description: statusDescription(status),
    content: {
      "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } },
    },
  };
}

function parametersFor(
  schema: ContractSchema<object> | undefined,
  location: "header" | "path",
): JsonObject[] {
  if (!schema || typeof schema.document !== "object") return [];
  const document = schema.document as JsonObject;
  const properties = document.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return [];

  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: location,
    required:
      location === "path" || (Array.isArray(document.required) && document.required.includes(name)),
    schema: schemaFor(property as JSONSchema),
  }));
}

function requestBodyFor(
  request: NonNullable<OpenApiRouteContract["request"]>,
): JsonObject | undefined {
  if (request.json) {
    return {
      required: true,
      content: { "application/json": { schema: schemaFor(request.json.document) } },
    };
  }
  if (request.multipart) {
    return {
      required: true,
      content: {
        "multipart/form-data": {
          schema: {
            type: "object",
            "x-rhizome-typescript-type": "FormData",
            required: ["metadata"],
            properties: {
              metadata: {
                type: "string",
                contentMediaType: "application/json",
                contentSchema: schemaFor(request.multipart.document),
              },
            },
            // Every other named part is an upload. The multipart validator rejects text
            // fields here, so the public document must describe binary values too.
            additionalProperties: { type: "string", format: "binary" },
          },
        },
      },
    };
  }
  if (request.binary) {
    return {
      required: true,
      content: { [request.binary.contentType]: { schema: schemaFor(request.binary.document) } },
    };
  }
  return undefined;
}

function headersFor(headers: Readonly<Record<string, JSONSchema>>): JsonObject {
  return Object.fromEntries(
    Object.entries(headers).map(([name, document]) => {
      const description =
        typeof document === "object" && typeof document.description === "string"
          ? { description: document.description }
          : {};
      return [name, { ...description, schema: schemaFor(document) }];
    }),
  );
}

function responseFor(
  status: number,
  response:
    ContractSchema<unknown> | ContractResponseWithHeaders | UnvalidatedContractResponse | null,
): JsonObject {
  if (!response) return { description: statusDescription(status) };
  if ("schema" in response) {
    return { ...responseFor(status, response.schema), headers: headersFor(response.headers) };
  }
  if ("validate" in response) {
    const contentType =
      storeComponentForSchema(response.document) === "Problem"
        ? "application/problem+json"
        : "application/json";
    return {
      description: statusDescription(status),
      content: { [contentType]: { schema: schemaFor(response.document) } },
    };
  }
  if (!response.document || !response.contentType) return { description: response.description };
  return {
    description: response.description,
    content: { [response.contentType]: { schema: schemaFor(response.document) } },
  };
}

function schemaFor(document: JSONSchema): OpenApiSchema {
  const storeComponent = storeComponentForSchema(document);
  if (storeComponent) return { $ref: `#/components/schemas/${storeComponent}` };
  if (typeof document === "object" && typeof document.$id === "string") {
    const component = componentForId(document.$id);
    if (component) return { $ref: `#/components/schemas/${component}` };
  }
  return localizeSchemaForOpenApi(document);
}

function storeComponentForSchema(document: JSONSchema): string | undefined {
  return typeof document === "object" && document !== null
    ? STORE_COMPONENT_FOR_SCHEMA.get(document)
    : undefined;
}

function localizeSchemaForOpenApi(value: JSONSchema | unknown): OpenApiSchema {
  if (typeof value === "boolean") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value as OpenApiSchema;
  }

  const rewritten: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "$id" || key === "$schema") continue;
    if (key === "$ref" && typeof child === "string") {
      const component = componentForId(child);
      rewritten[key] = component ? `#/components/schemas/${component}` : child;
      continue;
    }
    rewritten[key] = Array.isArray(child)
      ? child.map((entry) => localizeSchemaForOpenApi(entry))
      : child && typeof child === "object"
        ? localizeSchemaForOpenApi(child)
        : child;
  }
  return rewritten;
}

function componentForId(id: string): string | undefined {
  for (const [name, document] of Object.entries(RNET_DOCUMENTS)) {
    if (typeof document === "object" && document.$id === id) {
      return COMPONENT_NAMES[name as keyof typeof COMPONENT_NAMES];
    }
  }
  return undefined;
}

function statusDescription(status: number): string {
  if (status === 204) return "No content";
  if (status >= 200 && status < 300) return "Successful response";
  return "Problem response";
}

function tagForOperation(operationId: string): string {
  if (operationId.includes("MediaObject")) return "Media Objects";
  if (operationId.includes("MediaElement")) return "Media Elements";
  if (operationId.includes("OriginArtifact")) return "Origin Artifacts";
  if (operationId.includes("Operation")) return "Operations";
  return "Vibes";
}
