export const ACTIVE_INFERENCE_POLL_MS = 1_000;
// Keep discovering work started elsewhere without waking every surface once per second.
export const IDLE_INFERENCE_POLL_MS = 10_000;

export function isInferenceActive(status: string | undefined): boolean {
  return status === "waiting" || status === "running";
}
