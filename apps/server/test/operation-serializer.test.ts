import { describe, expect, test } from "bun:test";

import type { DbOperation } from "../src/db/models/operation.ts";
import { serializeOperation } from "../src/serializers/operation-serializer.ts";

const source = "source:0198f2a1-a001-7a01-8001-000000000001";
const continuationToken = "opaque-continuation-token-that-is-long-enough";

const actionFailure: DbOperation = {
  uuid: "0198f2a1-a002-7a02-8002-000000000002",
  kind: "pull",
  status: "failed",
  invokedBy: "client:puller",
  ownerUuid: "0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47",
  vibeUuid: "0198f2a1-a003-7a03-8003-000000000003",
  request: { mode: "pull", sources: [source], dry_run: false },
  result: {
    code: "source_action_required",
    required_action: {
      kind: "source_action_required",
      action: "review_import",
      title: "Provider-specific owner title",
      detail: "Provider-private owner detail",
      source,
      continuation_token: continuationToken,
    },
  },
  reviewDigest: null,
  committedAt: null,
  error: "Provider-private owner detail",
  createdAt: new Date("2026-08-30T12:00:00.000Z"),
  finishedAt: new Date("2026-08-30T12:00:01.000Z"),
};

describe("operation source-action privacy", () => {
  test("push always hides resolved execution state and exposes usage only to the owner", () => {
    const operation: DbOperation = {
      ...actionFailure,
      kind: "push",
      status: "done",
      request: {
        mode: "push",
        level: "object",
        task: "label",
        resolved: { selection: ["private-member"] },
      },
      result: { level: "object", task: "label", usage: { tokens_in: 100 }, written: [] },
    };
    for (const exposeOwnerOnlyResult of [true, false]) {
      const document = serializeOperation(operation, { exposeOwnerOnlyResult });
      expect(document.request).toEqual({ mode: "push", level: "object", task: "label" });
      expect(Object.hasOwn(document.result!, "usage")).toBe(exposeOwnerOnlyResult);
      expect(document.result).toHaveProperty("written");
    }
    expect(operation.request).toHaveProperty("resolved");
    expect(operation.result).toHaveProperty("usage");
  });
  test("preserves the owner action envelope", () => {
    const serialized = serializeOperation(actionFailure, { exposeOwnerOnlyResult: true });

    expect(serialized.result).toEqual(actionFailure.result);
    expect(serialized.error).toBe("Provider-private owner detail");
    expect(serialized.request).toEqual(actionFailure.request);
  });

  test("gives pull grantees only a generic owner-action marker and error", () => {
    const serialized = serializeOperation(actionFailure, { exposeOwnerOnlyResult: false });

    expect(serialized.result).toEqual({
      action: "review_import",
      code: "source_action_required",
      owner_action_required: true,
    });
    expect(serialized.error).toBe(
      "The connected source owner must review an import before pulling again.",
    );
    expect(serialized.request).toEqual({ mode: "pull", dry_run: false });
    expect(JSON.stringify(serialized)).not.toContain(source);
    expect(JSON.stringify(serialized)).not.toContain(continuationToken);
    expect(JSON.stringify(serialized)).not.toContain("Provider-private");
  });

  test("redacts non-action skill failures from pull grantees", () => {
    const failure: DbOperation = {
      ...actionFailure,
      result: {
        code: "provider_failure",
        debug_detail: "owner-private parser state",
      },
      error: "Parser exposed an owner-private account identifier",
    };

    const owner = serializeOperation(failure, { exposeOwnerOnlyResult: true });
    expect(owner.result).toEqual(failure.result);
    expect(owner.error).toBe(failure.error);

    const grantee = serializeOperation(failure, { exposeOwnerOnlyResult: false });
    expect(grantee.result).toBeNull();
    expect(grantee.error).toBe("The pull operation could not complete.");
    expect(JSON.stringify(grantee)).not.toContain("owner-private");
    expect(JSON.stringify(grantee)).not.toContain("account identifier");
  });
});
