import type { SourceExecutionLimits } from "../../../packages/store-contract/src/source-skills.ts";

import type { CandidateBundle } from "./candidate-bundle.ts";

export type SourceExecutionLimitKind =
  "candidates" | "capture_bytes" | "element_bytes" | "total_element_bytes";

export class SourceExecutionLimitError extends Error {
  constructor(
    readonly kind: SourceExecutionLimitKind,
    readonly actual: number,
    readonly limit: number,
  ) {
    super(`Source ${kind.replaceAll("_", " ")} ${actual} exceeds limit ${limit}`);
    this.name = "SourceExecutionLimitError";
  }
}

export function assertCaptureLimit(byteLength: number, limits: SourceExecutionLimits): void {
  if (byteLength > limits.maxCaptureBytes) {
    throw new SourceExecutionLimitError("capture_bytes", byteLength, limits.maxCaptureBytes);
  }
}

export function assertCandidateBundleLimits(
  bundle: CandidateBundle,
  limits: SourceExecutionLimits,
): void {
  if (bundle.candidates.length > limits.maxCandidates) {
    throw new SourceExecutionLimitError(
      "candidates",
      bundle.candidates.length,
      limits.maxCandidates,
    );
  }
  let totalElementBytes = 0;
  for (const candidate of bundle.candidates) {
    for (const element of candidate.elements) {
      if (element.byteSize > limits.maxElementBytes) {
        throw new SourceExecutionLimitError(
          "element_bytes",
          element.byteSize,
          limits.maxElementBytes,
        );
      }
      totalElementBytes += element.byteSize;
      if (
        !Number.isSafeInteger(totalElementBytes) ||
        totalElementBytes > limits.maxTotalElementBytes
      ) {
        throw new SourceExecutionLimitError(
          "total_element_bytes",
          totalElementBytes,
          limits.maxTotalElementBytes,
        );
      }
    }
  }
}
