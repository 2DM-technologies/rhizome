import type { MODEL_CONNECTOR_ERROR_KINDS } from "@rhizome/store-contract";
import type { JSONSchema } from "json-schema-to-ts";

export const MODEL_TARGET_PATTERN = "^model:[a-z][a-z0-9-]*/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$";
export interface ModelTarget {
  provider: string;
  name: string;
}
export function parseModelTarget(target: string): ModelTarget {
  if (!new RegExp(MODEL_TARGET_PATTERN).test(target)) throw new Error("Invalid model target");
  const [provider, name] = target.slice("model:".length).split("/") as [string, string];
  return { provider, name };
}
export function modelIdentity(target: ModelTarget): string {
  return `${target.provider}/${target.name}`;
}
export interface CompletionRequest {
  target: ModelTarget;
  instructions: string;
  input: string;
  attachments?: Array<{ ref: string; mime: string; bytes: Uint8Array }>;
  schema: JSONSchema;
  schemaName: string;
  effort: "low" | "medium" | "high";
  maxOutputTokens: number;
  timeoutMs: number;
  signal: AbortSignal;
  trace: { operationUuid: string; call: number };
}
export interface ModelUsage {
  tokensIn: number;
  cachedTokensIn: number;
  cacheWriteTokensIn: number;
  tokensOut: number;
  reasoningTokensOut: number;
  servedTier: "flex" | "standard";
  servedTierRaw: string | null;
  tierAssumed: boolean;
  providerModel: string | null;
  providerRequestId: string | null;
  durationMs: number;
  attempts: number;
}
export interface CompletionResult {
  output: unknown;
  usage: ModelUsage;
}
export type ModelConnectorErrorKind = (typeof MODEL_CONNECTOR_ERROR_KINDS)[number];
export class ModelConnectorError extends Error {
  readonly kind: ModelConnectorErrorKind;
  readonly retryable: boolean;
  readonly status?: number;
  readonly providerRequestId?: string;
  readonly usage?: ModelUsage;
  constructor(
    kind: ModelConnectorErrorKind,
    options: {
      retryable: boolean;
      status?: number;
      providerRequestId?: string;
      usage?: ModelUsage;
    },
  ) {
    super(`Model completion failed: ${kind}`);
    this.name = "ModelConnectorError";
    this.kind = kind;
    this.retryable = options.retryable;
    this.status = options.status;
    this.providerRequestId = options.providerRequestId;
    this.usage = options.usage;
  }
}
export interface CostReport {
  usd: string;
  rateCard: {
    id: string;
    source: string;
    verifiedAt: string;
    tier: "flex" | "standard";
    longContext: boolean;
  };
}
export interface ModelConnector {
  provider: string;
  models: readonly string[];
  complete(request: CompletionRequest): Promise<CompletionResult>;
  countTokens(
    input: Pick<CompletionRequest, "target" | "instructions" | "input" | "attachments">,
  ): Promise<number>;
  reportCost(usage: ModelUsage, target: ModelTarget): CostReport;
}
