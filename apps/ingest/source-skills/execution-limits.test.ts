import { describe, expect, test } from "bun:test";

import { candidateBundle, type SourceCandidateDraft } from "./candidate-bundle.ts";
import {
  SourceExecutionLimitError,
  assertCandidateBundleLimits,
  assertCaptureLimit,
} from "./execution-limits.ts";

const limits = {
  maxCandidates: 2,
  maxCaptureBytes: 10,
  maxElementBytes: 4,
  maxTotalElementBytes: 6,
} as const;

describe("generic source execution limits", () => {
  test("enforces capture and candidate limits independently", () => {
    expect(() => assertCaptureLimit(10, limits)).not.toThrow();
    expect(() => assertCaptureLimit(11, limits)).toThrow(
      new SourceExecutionLimitError("capture_bytes", 11, 10),
    );

    const draft = candidate("one", []);
    expect(() =>
      assertCandidateBundleLimits(candidateBundle([draft, draft, draft], verified()), limits),
    ).toThrow(new SourceExecutionLimitError("candidates", 3, 2));
  });

  test("counts every element kind toward per-element and aggregate byte budgets", () => {
    const oversized = candidate("oversized", [element("text", 5)]);
    expect(() =>
      assertCandidateBundleLimits(candidateBundle([oversized], verified()), limits),
    ).toThrow(new SourceExecutionLimitError("element_bytes", 5, 4));

    const aggregate = candidate("aggregate", [element("text", 3), element("image", 4)]);
    expect(() =>
      assertCandidateBundleLimits(candidateBundle([aggregate], verified()), limits),
    ).toThrow(new SourceExecutionLimitError("total_element_bytes", 7, 6));

    expect(() =>
      assertCandidateBundleLimits(
        candidateBundle(
          [candidate("bounded", [element("text", 2), element("video", 4)])],
          verified(),
        ),
        limits,
      ),
    ).not.toThrow();
  });
});

function candidate(id: string, elements: SourceCandidateDraft["elements"]): SourceCandidateDraft {
  return {
    type: "synthetic",
    keys: { id },
    sourceProperties: {},
    semanticIdentity: { id },
    elements,
  };
}

function element(kind: "text" | "image" | "video", byteSize: number) {
  return {
    role: "content" as const,
    kind,
    mime: kind === "text" ? "text/plain" : `${kind}/synthetic`,
    bytes: new Uint8Array(byteSize),
    byteSize,
    contentHash: `sha256:${"0".repeat(64)}` as const,
  };
}

function verified() {
  return { ok: true, checks: [] } as const;
}
