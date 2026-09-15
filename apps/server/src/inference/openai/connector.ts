import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  ModelConnectorError,
  type CompletionRequest,
  type CompletionResult,
  type ModelConnector,
  type ModelConnectorErrorKind,
  type ModelTarget,
  type ModelUsage,
} from "../model-connector.ts";
import { assertStructuredOutputSchema } from "../structured-output-schema.ts";
import type { OpenAIProviderSettings } from "./config.ts";
import { priceUsage } from "./rate-card.ts";
import { countLunaInputTokens } from "./image-tokens.ts";
import {
  hasOpenAIResponseUsage,
  isOpenAIResponsesResponse,
  type OpenAIResponsesRequest,
  type OpenAIResponsesResponse,
} from "./responses-api.ts";

const MAX_ATTEMPTS = 4;
const SCHEMA_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const NO_BODY = Symbol("no response body");

export interface OpenAIConnectorDependencies {
  fetch?: OpenAIFetch;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
}

export type OpenAIFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class OpenAIConnector implements ModelConnector {
  readonly provider = "openai";
  readonly models = ["gpt-5.6-luna"] as const;
  private readonly fetch: OpenAIFetch;
  private readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  private readonly now: () => number;
  private readonly ajv = addFormats(new Ajv2020({ strict: true, allowUnionTypes: true }));

  constructor(
    private readonly settings: OpenAIProviderSettings,
    dependencies: OpenAIConnectorDependencies = {},
  ) {
    this.fetch = dependencies.fetch ?? globalThis.fetch;
    this.sleep = dependencies.sleep ?? abortableSleep;
    this.now = dependencies.now ?? Date.now;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    if (request.signal.aborted) throw connectorError("aborted");
    if (
      request.target.provider !== this.provider ||
      !(this.models as readonly string[]).includes(request.target.name)
    )
      throw connectorError("invalid_request");
    if (!SCHEMA_NAME_PATTERN.test(request.schemaName)) throw connectorError("invalid_request");
    assertStructuredOutputSchema(request.schema);

    const startedAt = this.now();
    const deadline = startedAt + request.timeoutMs;
    const body = this.requestBody(request);
    let lastError: ModelConnectorError | undefined;

    for (let attempts = 1; attempts <= MAX_ATTEMPTS; attempts++) {
      if (request.signal.aborted) throw connectorError("aborted");
      const remaining = deadline - this.now();
      if (remaining <= 0) throw connectorError("timeout");

      let response: Response;
      let value: unknown | typeof NO_BODY;
      try {
        ({ response, value } = await this.fetchWithDeadline(body, request.signal, remaining));
      } catch (error) {
        if (error instanceof ModelConnectorError) throw error;
        if (request.signal.aborted) throw connectorError("aborted");
        if (this.now() >= deadline) throw connectorError("timeout");
        lastError = connectorError("provider_unavailable", { retryable: true });
        if (attempts === MAX_ATTEMPTS) throw lastError;
        await this.waitToRetry(attempts, deadline, request.signal, lastError);
        continue;
      }

      const requestId = response.headers.get("x-request-id") ?? undefined;
      const parsedResponse =
        value !== NO_BODY && isOpenAIResponsesResponse(value) ? value : undefined;
      const billedUsage =
        parsedResponse && hasOpenAIResponseUsage(parsedResponse)
          ? mapUsage(
              parsedResponse,
              parsedResponse.usage,
              requestId,
              Math.max(0, this.now() - startedAt),
              attempts,
            )
          : undefined;
      if (request.signal.aborted)
        throw connectorError("aborted", { requestId, usage: billedUsage });
      if (this.now() >= deadline)
        throw connectorError("timeout", { requestId, usage: billedUsage });

      if (!response.ok) {
        const kind = statusKind(response.status);
        const retryable = isRetryableStatus(response.status);
        lastError = connectorError(kind, { retryable, status: response.status, requestId });
        if (!retryable || attempts === MAX_ATTEMPTS) throw lastError;
        await this.waitToRetry(
          attempts,
          deadline,
          request.signal,
          lastError,
          retryAfterMs(response.headers.get("retry-after"), this.now()),
        );
        continue;
      }

      if (value === NO_BODY)
        throw connectorError("provider_unavailable", { status: response.status, requestId });
      if (!isOpenAIResponsesResponse(value))
        throw connectorError("provider_unavailable", { status: response.status, requestId });
      return this.mapResponse(value, request, requestId, startedAt, attempts);
    }
    throw lastError ?? connectorError("provider_unavailable", { retryable: true });
  }

  async countTokens(
    input: Pick<CompletionRequest, "instructions" | "input" | "attachments">,
  ): Promise<number> {
    return countLunaInputTokens(input);
  }

  reportCost(usage: ModelUsage, target: ModelTarget) {
    return priceUsage(usage, target);
  }

  private requestBody(request: CompletionRequest): OpenAIResponsesRequest {
    const content: OpenAIResponsesRequest["input"][number]["content"] = [
      { type: "input_text", text: request.input },
    ];
    for (const { ref, mime, bytes } of request.attachments ?? []) {
      content.push({ type: "input_text", text: ref });
      content.push({
        type: "input_image",
        detail: "high",
        image_url: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
      });
    }
    return {
      model: request.target.name,
      service_tier: "flex",
      store: false,
      instructions: request.instructions,
      input: [{ role: "user", content }],
      text: {
        format: {
          type: "json_schema",
          name: request.schemaName,
          strict: true,
          schema: request.schema,
        },
      },
      reasoning: { effort: request.effort },
      max_output_tokens: request.maxOutputTokens,
      metadata: { rhizome_operation: request.trace.operationUuid },
    };
  }

  private async fetchWithDeadline(
    body: OpenAIResponsesRequest,
    operationSignal: AbortSignal,
    remaining: number,
  ): Promise<{ response: Response; value: unknown | typeof NO_BODY }> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    operationSignal.addEventListener("abort", abort, { once: true });
    let deadlineElapsed = false;
    const timer = setTimeout(() => {
      deadlineElapsed = true;
      controller.abort();
    }, remaining);
    try {
      const response = await this.fetch(`${this.settings.baseUrl}/v1/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.settings.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) return { response, value: NO_BODY };
      try {
        return { response, value: await response.json() };
      } catch {
        if (operationSignal.aborted) throw connectorError("aborted");
        if (deadlineElapsed) throw connectorError("timeout");
        return { response, value: NO_BODY };
      }
    } catch (error) {
      if (error instanceof ModelConnectorError) throw error;
      if (operationSignal.aborted) throw connectorError("aborted");
      if (deadlineElapsed) throw connectorError("timeout");
      throw error;
    } finally {
      clearTimeout(timer);
      operationSignal.removeEventListener("abort", abort);
    }
  }

  private async waitToRetry(
    attempts: number,
    deadline: number,
    signal: AbortSignal,
    lastError: ModelConnectorError,
    retryAfter?: number,
  ): Promise<void> {
    const remaining = deadline - this.now();
    const delay = Math.max(500 * 2 ** (attempts - 1), retryAfter ?? 0);
    if (retryAfter !== undefined && retryAfter >= remaining) throw lastError;
    if (remaining <= 0) throw connectorError("timeout");
    try {
      await this.sleep(Math.min(delay, remaining), signal);
    } catch {
      if (signal.aborted) throw connectorError("aborted");
      throw connectorError("timeout");
    }
    if (signal.aborted) throw connectorError("aborted");
  }

  private mapResponse(
    response: OpenAIResponsesResponse,
    request: CompletionRequest,
    requestId: string | undefined,
    startedAt: number,
    attempts: number,
  ): CompletionResult {
    const usage = hasOpenAIResponseUsage(response)
      ? mapUsage(response, response.usage, requestId, Math.max(0, this.now() - startedAt), attempts)
      : undefined;
    const error = (kind: ModelConnectorErrorKind, retryable = false) =>
      connectorError(kind, { retryable, requestId, usage });

    if (response.status === "failed") throw error("provider_unavailable", true);
    if (["queued", "in_progress", "cancelled"].includes(response.status))
      throw error("provider_unavailable", true);
    if (!usage) throw error("provider_unavailable", true);
    if (response.status === "incomplete") {
      if (response.incomplete_details?.reason === "max_output_tokens")
        throw error("output_truncated");
      if (response.incomplete_details?.reason === "content_filter") throw error("output_refused");
      throw error("output_invalid");
    }

    const content: Array<{ type: string; text?: unknown }> = [];
    if (Array.isArray(response.output)) {
      for (const item of response.output) {
        if (!item || typeof item !== "object" || !Array.isArray(item.content)) continue;
        for (const part of item.content) {
          if (part && typeof part === "object" && typeof part.type === "string") content.push(part);
        }
      }
    }
    if (content.some((part) => part.type === "refusal")) throw error("output_refused");
    const text = content.find((part) => part.type === "output_text");
    if (!text || typeof text.text !== "string") throw error("output_invalid");
    let output: unknown;
    try {
      output = JSON.parse(text.text);
    } catch {
      throw error("output_invalid");
    }
    if (!this.ajv.compile(request.schema)(output)) throw error("output_invalid");
    return { output, usage };
  }
}

function mapUsage(
  response: OpenAIResponsesResponse,
  usage: NonNullable<OpenAIResponsesResponse["usage"]>,
  requestId: string | undefined,
  durationMs: number,
  attempts: number,
): ModelUsage {
  const raw = response.service_tier ?? null;
  const tier = raw === "flex" ? "flex" : "standard";
  return {
    tokensIn: usage.input_tokens,
    cachedTokensIn: usage.input_tokens_details?.cached_tokens ?? 0,
    cacheWriteTokensIn: usage.cache_write_tokens ?? 0,
    tokensOut: usage.output_tokens,
    reasoningTokensOut: usage.output_tokens_details?.reasoning_tokens ?? 0,
    servedTier: raw === null ? "flex" : tier,
    servedTierRaw: raw,
    tierAssumed: raw === null || (raw !== "flex" && raw !== "default"),
    providerModel: response.model ?? null,
    providerRequestId: requestId ?? null,
    durationMs,
    attempts,
  };
}

function statusKind(status: number): ModelConnectorErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 408) return "timeout";
  if (status === 409) return "provider_unavailable";
  if (status === 429) return "rate_limited";
  if (status === 400 || status === 422 || (status >= 400 && status < 500)) return "invalid_request";
  return "provider_unavailable";
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function retryAfterMs(value: string | null, now: number): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

function connectorError(
  kind: ModelConnectorErrorKind,
  options: {
    retryable?: boolean;
    status?: number;
    requestId?: string;
    usage?: ModelUsage;
  } = {},
): ModelConnectorError {
  return new ModelConnectorError(kind, {
    retryable: options.retryable ?? false,
    ...(options.status === undefined ? {} : { status: options.status }),
    ...(options.requestId === undefined ? {} : { providerRequestId: options.requestId }),
    ...(options.usage === undefined ? {} : { usage: options.usage }),
  });
}

function abortableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}
