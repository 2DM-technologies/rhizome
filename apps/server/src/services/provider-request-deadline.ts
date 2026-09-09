import type { SourceExecutionLimits } from "@rhizome/store-contract";

const PROVIDER_REQUEST_TIMEOUT_MILLISECONDS = 15_000;
const MINIMUM_CAPTURE_BYTES_PER_SECOND = 128 * 1_024;
const MAXIMUM_CAPTURE_TIMEOUT_MILLISECONDS = 10 * 60 * 1_000;

/**
 * Sizes a provider-neutral capture deadline from the persisted artifact byte contract. The floor
 * intentionally tolerates provider round trips and a slow-but-usable transfer without creating an
 * unbounded request; connection exchange/refresh/revoke keep the short default deadline.
 */
export function sourceCaptureProviderTimeoutMilliseconds(limits: SourceExecutionLimits): number {
  if (!Number.isSafeInteger(limits.maxCaptureBytes) || limits.maxCaptureBytes <= 0) {
    throw new Error("Source capture byte limit is invalid");
  }
  const transferMilliseconds =
    Math.ceil(limits.maxCaptureBytes / MINIMUM_CAPTURE_BYTES_PER_SECOND) * 1_000;
  return Math.min(
    MAXIMUM_CAPTURE_TIMEOUT_MILLISECONDS,
    PROVIDER_REQUEST_TIMEOUT_MILLISECONDS + transferMilliseconds,
  );
}

/**
 * Signals the provider deadline, then retains the caller's lease/state until the adapter settles.
 * Adapters are required to observe the signal. Waiting for settlement is deliberate: returning
 * while provider code is still rotating or issuing credentials would allow overlapping requests
 * and could discard the only usable token set.
 */
export async function withProviderRequestDeadline<Value>(
  operation: (signal: AbortSignal) => Promise<Value>,
  timeoutMilliseconds = PROVIDER_REQUEST_TIMEOUT_MILLISECONDS,
): Promise<Value> {
  if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds <= 0) {
    throw new Error("Source provider request timeout is invalid");
  }
  const controller = new AbortController();
  let expired = false;
  const timeout = setTimeout(() => {
    expired = true;
    controller.abort();
  }, timeoutMilliseconds);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (expired) throw new Error("Source provider request timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
