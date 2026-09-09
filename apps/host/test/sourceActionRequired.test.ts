import { describe, expect, test } from "bun:test";

import { sourceActionRequired } from "../src/surfaces/sourceActionRequired.ts";

const configuredSource = "source:0198f2a1-0901-7101-a001-000000000001";
const otherSource = "source:0198f2a1-0901-7101-a001-000000000002";
const continuationToken = "opaque-owner-continuation-token-with-enough-entropy";

const requiredAction = {
  kind: "source_action_required",
  action: "review_import",
  title: "Connected source needs review",
  detail: "Review the available source records before refreshing again.",
  source: configuredSource,
  continuation_token: continuationToken,
} as const;

describe("source action requirements", () => {
  test("accepts configured review continuations from synchronous and polled failures", () => {
    const problem = {
      type: "https://rnet.network/problems/source-action-required",
      title: requiredAction.title,
      status: 422,
      detail: requiredAction.detail,
      code: "source_action_required",
      required_action: requiredAction,
    };
    const failedOperationResult = {
      code: "source_action_required",
      required_action: requiredAction,
    };

    expect(sourceActionRequired(problem, undefined, [configuredSource])).toEqual(requiredAction);
    expect(sourceActionRequired(undefined, failedOperationResult, [configuredSource])).toEqual(
      requiredAction,
    );
  });

  test("rejects redacted, malformed, and unconfigured action metadata", () => {
    expect(
      sourceActionRequired(
        undefined,
        { code: "source_action_required", action: "review_import", owner_action_required: true },
        [configuredSource],
      ),
    ).toBeUndefined();
    expect(
      sourceActionRequired(
        undefined,
        {
          code: "source_action_required",
          required_action: { ...requiredAction, source: otherSource },
        },
        [configuredSource],
      ),
    ).toBeUndefined();
    expect(
      sourceActionRequired(
        undefined,
        {
          code: "source_action_required",
          required_action: { ...requiredAction, continuation_token: "too-short" },
        },
        [configuredSource],
      ),
    ).toBeUndefined();
    expect(
      sourceActionRequired(
        undefined,
        {
          code: "source_action_required",
          required_action: { ...requiredAction, provider_state: "must stay private" },
        },
        [configuredSource],
      ),
    ).toBeUndefined();
  });

  test("requires the generic outer error code and action kind", () => {
    expect(
      sourceActionRequired(
        {
          type: "https://rnet.network/problems/schema-violation",
          title: "Invalid request",
          status: 422,
          detail: "No continuation is available.",
          code: "schema_violation",
          required_action: requiredAction,
        },
        undefined,
        [configuredSource],
      ),
    ).toBeUndefined();
    expect(
      sourceActionRequired(
        undefined,
        {
          code: "source_action_required",
          required_action: { ...requiredAction, action: "unknown_action" },
        },
        [configuredSource],
      ),
    ).toBeUndefined();
  });

  test("accepts a server-bound pending destination only for a pending Vibe review", () => {
    const pendingAction = {
      ...requiredAction,
      source: otherSource,
      destination: {
        kind: "pending_vibe",
        id: "0198f2a1-0901-7101-a001-000000000003",
      },
    } as const;
    const result = {
      code: "source_action_required",
      required_action: pendingAction,
    };

    expect(sourceActionRequired(undefined, result, [], true)).toEqual(pendingAction);
    expect(sourceActionRequired(undefined, result, [], false)).toBeUndefined();
    expect(
      sourceActionRequired(
        undefined,
        {
          ...result,
          required_action: {
            ...pendingAction,
            destination: { kind: "pending_vibe", id: "not-a-uuidv7" },
          },
        },
        [],
        true,
      ),
    ).toBeUndefined();
  });
});
