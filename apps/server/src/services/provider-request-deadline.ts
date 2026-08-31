const PROVIDER_REQUEST_TIMEOUT_MILLISECONDS = 15_000;

/**
 * Signals the provider deadline, then retains the caller's lease/state until the adapter settles.
 * Adapters are required to observe the signal. Waiting for settlement is deliberate: returning
 * while provider code is still rotating or issuing credentials would allow overlapping requests
 * and could discard the only usable token set.
 */
export async function withProviderRequestDeadline<Value>(
  operation: (signal: AbortSignal) => Promise<Value>,
): Promise<Value> {
  const controller = new AbortController();
  let expired = false;
  const timeout = setTimeout(() => {
    expired = true;
    controller.abort();
  }, PROVIDER_REQUEST_TIMEOUT_MILLISECONDS);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (expired) throw new Error("Source provider request timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
