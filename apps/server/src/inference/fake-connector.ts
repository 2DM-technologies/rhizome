import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { JSONSchema } from "json-schema-to-ts";
import {
  ModelConnectorError,
  type CompletionRequest,
  type CompletionResult,
  type ModelConnector,
  type ModelTarget,
  type ModelUsage,
} from "./model-connector.ts";
import { priceUsage } from "./openai/rate-card.ts";
import { countLunaInputTokens } from "./openai/image-tokens.ts";
import { assertStructuredOutputSchema } from "./structured-output-schema.ts";

/** Deterministic provider substitute; scripted failures carry the same usage as real responses. */
export class FakeModelConnector implements ModelConnector {
  readonly provider = "openai";
  readonly models = ["gpt-5.6-luna"] as const;
  readonly requests: CompletionRequest[] = [];
  private readonly ajv = addFormats(new Ajv2020({ strict: true, allowUnionTypes: true }));
  constructor(
    private readonly options: {
      respond?: (
        request: CompletionRequest,
      ) => CompletionResult | ModelConnectorError | Promise<CompletionResult | ModelConnectorError>;
    } = {},
  ) {}
  async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.requests.push(request);
    if (request.signal.aborted) throw new ModelConnectorError("aborted", { retryable: false });
    assertStructuredOutputSchema(request.schema);
    const response = this.options.respond
      ? await this.options.respond(request)
      : {
          output: sample(request.schema),
          usage: {
            tokensIn: await this.countTokens(request),
            cachedTokensIn: 0,
            cacheWriteTokensIn: 0,
            tokensOut: 100,
            reasoningTokensOut: 0,
            servedTier: "flex",
            servedTierRaw: "flex",
            tierAssumed: false,
            providerModel: request.target.name,
            providerRequestId: `fake-${request.trace.call}`,
            durationMs: 1,
            attempts: 1,
          } satisfies ModelUsage,
        };
    if (response instanceof ModelConnectorError) throw response;
    if (!this.ajv.compile(request.schema)(response.output))
      throw new ModelConnectorError("output_invalid", { retryable: false, usage: response.usage });
    return response;
  }
  async countTokens(
    input: Pick<CompletionRequest, "instructions" | "input" | "attachments">,
  ): Promise<number> {
    return countLunaInputTokens(input);
  }
  reportCost(usage: ModelUsage, target: ModelTarget) {
    return priceUsage(usage, target);
  }
}

function sample(schema: JSONSchema): unknown {
  if (typeof schema !== "object") throw new Error("Expected a schema object");
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  if (schema.anyOf)
    return sample(
      schema.anyOf.find((branch) => typeof branch === "object" && branch.type !== "null") ??
        schema.anyOf[0]!,
    );
  const type = Array.isArray(schema.type)
    ? schema.type.find((type) => type !== "null")
    : schema.type;
  if (type === "object") {
    return Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([key, value]) => [key, sample(value)]),
    );
  }
  if (type === "array") {
    const items = schema.items as JSONSchema;
    if (
      typeof items === "object" &&
      items.properties?.ref &&
      typeof items.properties.ref === "object" &&
      Array.isArray(items.properties.ref.enum)
    ) {
      return items.properties.ref.enum.map((ref) => ({ ...(sample(items) as object), ref }));
    }
    return Array.from({ length: schema.minItems ?? 1 }, () => sample(items));
  }
  if (type === "number") return 0.5;
  if (type === "integer") return schema.minimum ?? 0;
  if (type === "boolean") return false;
  if (type === "null") return null;
  if (type === "string") {
    for (const candidate of ["fake", "/source/properties/fake"]) {
      if (!schema.pattern || new RegExp(schema.pattern).test(candidate)) return candidate;
    }
    throw new Error("No fake sample for the schema pattern");
  }
  throw new Error("Unsupported fake schema");
}
