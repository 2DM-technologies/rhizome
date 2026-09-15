import type { JSONSchema } from "json-schema-to-ts";

export interface OpenAIResponsesRequest {
  model: string;
  service_tier: "flex";
  store: false;
  instructions: string;
  input: Array<{
    role: "user";
    content: Array<
      | { type: "input_text"; text: string }
      | { type: "input_image"; image_url: string; detail: "high" }
    >;
  }>;
  text: {
    format: {
      type: "json_schema";
      name: string;
      strict: true;
      schema: JSONSchema;
    };
  };
  reasoning: { effort: "low" | "medium" | "high" };
  max_output_tokens: number;
  metadata: { rhizome_operation: string };
}

export interface OpenAIResponseUsage {
  input_tokens: number;
  input_tokens_details?: { cached_tokens?: number };
  cache_write_tokens?: number;
  output_tokens: number;
  output_tokens_details?: { reasoning_tokens?: number };
}

export interface OpenAIResponsesResponse {
  id: string;
  status: "completed" | "incomplete" | "failed" | "queued" | "in_progress" | "cancelled";
  model?: string | null;
  service_tier?: string | null;
  output?: Array<{
    type: string;
    content?: Array<{ type: string; text?: unknown; refusal?: unknown }>;
  }> | null;
  incomplete_details?: { reason?: string } | null;
  usage?: OpenAIResponseUsage | null;
}

export function isOpenAIResponsesResponse(value: unknown): value is OpenAIResponsesResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  return (
    typeof response.id === "string" &&
    ["completed", "incomplete", "failed", "queued", "in_progress", "cancelled"].includes(
      response.status as string,
    ) &&
    (response.model == null || typeof response.model === "string") &&
    (response.service_tier == null || typeof response.service_tier === "string") &&
    (response.incomplete_details == null || typeof response.incomplete_details === "object")
  );
}

export function hasOpenAIResponseUsage(
  response: OpenAIResponsesResponse,
): response is OpenAIResponsesResponse & { usage: OpenAIResponseUsage } {
  const usage = response.usage;
  return (
    usage !== undefined &&
    usage !== null &&
    typeof usage === "object" &&
    Number.isSafeInteger(usage.input_tokens) &&
    usage.input_tokens >= 0 &&
    Number.isSafeInteger(usage.output_tokens) &&
    usage.output_tokens >= 0 &&
    optionalNonnegativeInteger(usage.input_tokens_details?.cached_tokens) &&
    optionalNonnegativeInteger(usage.cache_write_tokens) &&
    optionalNonnegativeInteger(usage.output_tokens_details?.reasoning_tokens)
  );
}

function optionalNonnegativeInteger(value: number | undefined): boolean {
  return value === undefined || (Number.isSafeInteger(value) && value >= 0);
}
