import { describe, expect, test } from "bun:test";

import { sourceCaptureProviderTimeoutMilliseconds } from "../src/services/provider-request-deadline.ts";

describe("source provider capture deadline", () => {
  test("scales generically with the persisted capture byte contract and remains bounded", () => {
    const timeout = sourceCaptureProviderTimeoutMilliseconds({
      maxCandidates: 100,
      maxCaptureBytes: 48 * 1_024 * 1_024,
      maxElementBytes: 25 * 1_024 * 1_024,
      maxTotalElementBytes: 40 * 1_024 * 1_024,
    });

    expect(timeout).toBeGreaterThan(15_000);
    expect(timeout).toBeLessThanOrEqual(10 * 60 * 1_000);
    expect(() =>
      sourceCaptureProviderTimeoutMilliseconds({
        maxCandidates: 1,
        maxCaptureBytes: 0,
        maxElementBytes: 1,
        maxTotalElementBytes: 1,
      }),
    ).toThrow("capture byte limit is invalid");
  });
});
