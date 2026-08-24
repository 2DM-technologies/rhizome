import type { JSONSchema } from "json-schema-to-ts";

import {
  ProblemSchema,
  RNET_DOCUMENTS,
  routeContract,
  type ContractSchema,
  type UnvalidatedContractResponse,
} from "./routes/contracts.ts";

type JsonObject = Record<string, unknown>;
type OpenApiSchema = boolean | JsonObject;

interface RegisteredRoute {
  readonly handler: unknown;
  readonly method: string;
  readonly path: string;
}

const COMPONENT_NAMES = {
  grant: "Grant",
  "ingest-record": "IngestRecord",
  "media-element": "MediaElement",
  "media-object": "MediaObject",
  "origin-artifact": "OriginArtifact",
  track: "TrackProperties",
  transaction: "TransactionProperties",
  vibe: "Vibe",
} as const;

const SCHEMA_COMPONENTS = Object.fromEntries(
  Object.entries(RNET_DOCUMENTS).map(([name, document]) => [
    COMPONENT_NAMES[name as keyof typeof COMPONENT_NAMES],
    localizeSchemaForOpenApi(document),
  ]),
);

export function createOpenApiDocument(routes: readonly RegisteredRoute[]) {
  const paths: Record<string, Record<string, unknown>> = {};
  const operationIds = new Set<string>();

  for (const route of routes) {
    const contract = routeContract(route.handler);
    if (!contract) continue;
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
    paths,
    components: {
      securitySchemes: {
        BearerAuth: { type: "http", scheme: "bearer" },
      },
      schemas: {
        ...SCHEMA_COMPONENTS,
        Problem: localizeSchemaForOpenApi(ProblemSchema.document),
      },
    },
  } as const;
}

function operation(contract: NonNullable<ReturnType<typeof routeContract>>): JsonObject {
  const parameters = pathParameters(contract.request?.param);
  const requestBody = contract.request ? requestBodyFor(contract.request) : undefined;
  const responses: Record<string, unknown> = {};

  for (const [status, response] of Object.entries(contract.responses)) {
    responses[status] = responseFor(Number(status), response);
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

function pathParameters(schema: ContractSchema<object> | undefined): JsonObject[] {
  if (!schema || typeof schema.document !== "object") return [];
  const document = schema.document as JsonObject;
  const properties = document.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return [];

  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: "path",
    required: true,
    schema: schemaFor(property as JSONSchema),
  }));
}

function requestBodyFor(
  request: NonNullable<NonNullable<ReturnType<typeof routeContract>>["request"]>,
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
            required: ["metadata"],
            properties: {
              metadata: {
                type: "string",
                contentMediaType: "application/json",
                contentSchema: schemaFor(request.multipart.document),
              },
            },
            additionalProperties: true,
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

function responseFor(
  status: number,
  response: ContractSchema<unknown> | UnvalidatedContractResponse | null,
): JsonObject {
  if (!response) return { description: statusDescription(status) };
  if ("validate" in response) {
    const contentType =
      response.document === ProblemSchema.document
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
  if (document === ProblemSchema.document) return { $ref: "#/components/schemas/Problem" };
  if (typeof document === "object" && typeof document.$id === "string") {
    const component = componentForId(document.$id);
    if (component) return { $ref: `#/components/schemas/${component}` };
  }
  return localizeSchemaForOpenApi(document);
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
