import { describe, expect, test } from "bun:test";
import type { MediaObject } from "@rnet/types";
import {
  isPushOperation,
  pushVibeRequestSchema,
  pushOperationResultSchema,
  pushTaskManifestSchema,
  pushTaskManifestsResponseSchema,
  STORE_SCHEMA_COMPONENTS,
  storeTaskKey,
  resolvePointer,
  SKIP_REASONS,
  type OperationDocument,
  type PushOperationResult,
} from "@rhizome/store-contract";
import { jsonSchema } from "../src/routes/contracts.ts";

const uuid = "0198f2a1-0000-7000-8000-000000000001";
const request = jsonSchema(pushVibeRequestSchema);
const result = jsonSchema(pushOperationResultSchema);
const shared = {
  task: "summarize",
  model: null,
  llm_calls: 0,
  context: { truncated_objects: 0, truncated_pointers: 0, clipped_objects: 0 },
  abort_reason: null,
  usage: {
    tokens_in: 0,
    cached_tokens_in: 0,
    tokens_out: 0,
    usd: "0.000000",
    served_tiers: [],
    tier_assumed: false,
  },
} as const;

describe("push contracts", () => {
  test("selection contains records at the required task level", () => {
    for (const level of ["object", "element"] as const) {
      expect(
        request.validate({ level, task: "describe", selection: [`rnet://${level}/${uuid}`] }).ok,
      ).toBe(true);
      expect(request.validate({ level, task: "describe" }).ok).toBe(true);
      expect(request.validate({ level, task: "describe", selection: [] }).ok).toBe(false);
      expect(
        request.validate({
          level,
          task: "describe",
          selection: [`rnet://${level}/${uuid}`, `rnet://${level}/${uuid}`],
        }).ok,
      ).toBe(false);
      expect(
        request.validate({
          level,
          task: "describe",
          selection: [`rnet://${level === "object" ? "element" : "object"}/${uuid}`],
        }).ok,
      ).toBe(false);
    }
    expect(request.validate({ task: "summarize" }).ok).toBe(false);
    expect(request.validate({ level: "vibe", task: "summarize" }).ok).toBe(true);
    expect(
      request.validate({ level: "vibe", task: "summarize", selection: [`rnet://object/${uuid}`] })
        .ok,
    ).toBe(false);
    expect(request.validate({ level: "vibe", task: "rhizome:summarize" }).ok).toBe(false);
    expect(request.validate({ level: "vibe", task: "summarize", model: "anything" }).ok).toBe(
      false,
    );
  });

  test("all result levels validate and preservation has no revision", () => {
    for (const level of ["object", "element"] as const) {
      const value = {
        ...shared,
        level,
        [level === "object" ? "objects" : "elements"]: {
          selected: 1,
          sent: 1,
          written: 1,
          removed: 0,
          preserved_durable: 0,
          skipped: 0,
          failed: 0,
        },
        written: [{ uri: `rnet://${level}/${uuid}`, key: storeTaskKey("summarize"), rev: 1 }],
        preserved: [],
        skipped: [],
      };
      expect(result.validate(value).ok).toBe(true);
      expect(result.validate({ ...value, extra: true }).ok).toBe(false);
    }
    for (const vibe of [
      { outcome: "written", key: "rhizome:summarize", rev: 1 },
      { outcome: "preserved_durable", key: "rhizome:summarize" },
    ]) {
      expect(result.validate({ ...shared, level: "vibe", vibe }).ok).toBe(true);
    }
    expect(
      result.validate({
        ...shared,
        level: "vibe",
        vibe: { outcome: "preserved_durable", key: "rhizome:summarize", rev: 1 },
      }).ok,
    ).toBe(false);
    expect(result.validate({ ...shared, level: "vibe", vibe: null }).ok).toBe(false);
    for (const reason of SKIP_REASONS)
      expect(
        result.validate({ ...shared, level: "vibe", vibe: { outcome: "skipped", reason } }).ok,
      ).toBe(true);
    expect(
      result.validate({
        ...shared,
        level: "vibe",
        vibe: { outcome: "skipped", reason: "call_failed", code: "auth" },
      }).ok,
    ).toBe(true);
    expect(
      result.validate({ ...shared, level: "vibe", vibe: { outcome: "skipped", reason: "unknown" } })
        .ok,
    ).toBe(false);
    expect(
      result.validate({
        ...shared,
        level: "vibe",
        vibe: { outcome: "skipped", reason: "aborted", code: "auth" },
      }).ok,
    ).toBe(false);
    const { usage: _usage, ...publicFields } = shared;
    expect(
      result.validate({
        ...publicFields,
        level: "vibe",
        vibe: { outcome: "skipped", reason: "aborted" },
      }).ok,
    ).toBe(true);
  });

  test("narrows push by request.mode and registers canonical components", () => {
    const operation: OperationDocument = {
      operation_id: uuid,
      kind: "push",
      status: "queued",
      request: { mode: "push" },
      result: null,
      error: null,
      created_at: new Date().toISOString(),
    };
    expect(isPushOperation(operation)).toBe(true);
    if (isPushOperation(operation)) {
      const value: PushOperationResult | null = operation.result;
      expect(value).toBeNull();
    }
    expect(isPushOperation({ ...operation, request: { mode: "pull" } })).toBe(false);
    expect(STORE_SCHEMA_COMPONENTS.PushVibeRequest).toBe(pushVibeRequestSchema);
    expect(STORE_SCHEMA_COMPONENTS.PushOperationResult).toBe(pushOperationResultSchema);
    expect(STORE_SCHEMA_COMPONENTS.PushTaskManifest).toBe(pushTaskManifestSchema);
    expect(STORE_SCHEMA_COMPONENTS.PushTaskManifestsResponse).toBe(pushTaskManifestsResponseSchema);
    expect(storeTaskKey("search_keywords")).toBe("rhizome:search_keywords");
    expect(() => storeTaskKey("other:task")).toThrow();
  });

  test("resolves RFC 6901 escapes, missing fields and element reference boundaries", () => {
    const document = {
      source: { properties: { "a/b": { "~name": "value" }, list: [7] } },
      elements: [{ uri: `rnet://element/${uuid}` }],
    } as unknown as MediaObject;
    expect(resolvePointer(document, "/source/properties/a~1b/~0name")).toBe("value");
    expect(resolvePointer(document, "/source/properties/list/0")).toBe(7);
    expect(resolvePointer(document, "/elements/0")).toEqual(document.elements[0]);
    for (const pointer of [
      "",
      "bad",
      "/source/missing",
      "/source/properties/list/00",
      "/elements/0/uri",
      "/source/properties/~3",
      "/toString",
    ])
      expect(resolvePointer(document, pointer)).toBeUndefined();
  });
});
