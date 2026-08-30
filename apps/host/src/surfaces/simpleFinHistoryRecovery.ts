import { SOURCE_ID_PATTERN } from "@rhizome/store-contract";

const sourceIdPattern = new RegExp(SOURCE_ID_PATTERN);

/**
 * Resolves only owner-visible recovery metadata for a source already configured on this Vibe.
 * Synchronous preflight failures are RFC 9457 Problems; failures discovered after provider fetch
 * arrive in the polled operation result. Delegated operation results intentionally have no source.
 */
export function simpleFinHistoryRecoverySource(
  error: unknown,
  failedOperationResult: unknown,
  configuredSources: readonly string[],
): string | undefined {
  const source = synchronousHistoryGapSource(error) ?? asyncHistoryGapSource(failedOperationResult);
  return source && sourceIdPattern.test(source) && configuredSources.includes(source)
    ? source
    : undefined;
}

function synchronousHistoryGapSource(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.type === "string" &&
    typeof value.title === "string" &&
    typeof value.status === "number" &&
    typeof value.detail === "string" &&
    value.code === "simplefin_history_gap" &&
    value.recovery === "reviewed_rebaseline" &&
    typeof value.source === "string"
    ? value.source
    : undefined;
}

function asyncHistoryGapSource(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return value.code === "simplefin_history_gap" &&
    value.reason === "unreconciled_backdated_activity" &&
    value.recovery === "reviewed_rebaseline" &&
    typeof value.source === "string"
    ? value.source
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
