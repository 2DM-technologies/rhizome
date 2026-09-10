import type { SourceExecutionLimits, SourceSkillManifest } from "@rhizome/store-contract";

export interface PreparedSourceCapture {
  readonly blob: Blob;
  readonly label: string;
  readonly mime: string;
}

/**
 * A selected file is uploaded as-is. The manifest limit is checked here only so an oversized file
 * fails before the upload rather than after it; the server re-enforces every limit on the stored
 * capture and is the authority.
 */
export async function prepareSourceCapture(
  manifest: SourceSkillManifest,
  file: File,
): Promise<PreparedSourceCapture> {
  const capture = {
    blob: file as Blob,
    label: file.name,
    mime: file.type || "application/octet-stream",
  };
  assertPreparedCapture(capture, manifest.limits);
  return capture.blob.type === capture.mime
    ? capture
    : { ...capture, blob: new Blob([capture.blob], { type: capture.mime }) };
}

function assertPreparedCapture(
  capture: PreparedSourceCapture,
  limits: SourceExecutionLimits,
): void {
  if (
    !(capture.blob instanceof Blob) ||
    capture.blob.size <= 0 ||
    capture.blob.size > limits.maxCaptureBytes ||
    typeof capture.label !== "string" ||
    !capture.label.trim() ||
    typeof capture.mime !== "string" ||
    !capture.mime.trim()
  ) {
    throw new Error(
      capture.blob instanceof Blob && capture.blob.size > limits.maxCaptureBytes
        ? `Prepared capture exceeds the ${limits.maxCaptureBytes} byte limit`
        : "The selected file could not be prepared",
    );
  }
}
