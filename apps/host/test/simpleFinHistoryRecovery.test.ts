import { describe, expect, test } from "bun:test";

import { simpleFinHistoryRecoverySource } from "../src/surfaces/simpleFinHistoryRecovery.ts";

const configuredSource = "source:0198f2a1-0901-7101-a001-000000000001";
const otherSource = "source:0198f2a1-0901-7101-a001-000000000002";

describe("SimpleFIN history recovery metadata", () => {
  test("accepts configured owner recovery from synchronous and polled failures", () => {
    const problem = {
      type: "https://rnet.network/problems/simplefin_history_gap",
      title: "SimpleFIN history gap requires review",
      status: 422,
      detail: "The connected history needs owner review.",
      code: "simplefin_history_gap",
      recovery: "reviewed_rebaseline",
      source: configuredSource,
    };
    const failedOperationResult = {
      code: "simplefin_history_gap",
      reason: "unreconciled_backdated_activity",
      recovery: "reviewed_rebaseline",
      source: configuredSource,
    };

    expect(simpleFinHistoryRecoverySource(problem, undefined, [configuredSource])).toBe(
      configuredSource,
    );
    expect(
      simpleFinHistoryRecoverySource(undefined, failedOperationResult, [configuredSource]),
    ).toBe(configuredSource);
  });

  test("rejects redacted, malformed, and unconfigured operation recovery", () => {
    expect(
      simpleFinHistoryRecoverySource(
        undefined,
        { code: "simplefin_history_gap", recovery: "owner_reviewed_rebaseline" },
        [configuredSource],
      ),
    ).toBeUndefined();
    expect(
      simpleFinHistoryRecoverySource(
        undefined,
        {
          code: "simplefin_history_gap",
          reason: "unreconciled_backdated_activity",
          recovery: "reviewed_rebaseline",
          source: otherSource,
        },
        [configuredSource],
      ),
    ).toBeUndefined();
    expect(
      simpleFinHistoryRecoverySource(
        undefined,
        {
          code: "simplefin_history_gap",
          reason: "simplefin_history_gap",
          recovery: "reviewed_rebaseline",
          source: configuredSource,
        },
        [configuredSource],
      ),
    ).toBeUndefined();
  });
});
