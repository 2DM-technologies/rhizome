import { describe, expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { MediaObject, Vibe } from "@rnet/types";
import type { OperationDocument } from "@rhizome/store-contract";

import { PUSH_TASKS } from "../src/api/generated/push-tasks.ts";
import { invalidatePushResult } from "../src/queries/push.ts";
import { inferredObjectLabel, resolveVibeView } from "../src/surfaces/InferredVibeView.tsx";
import { missingObjectUris } from "../src/surfaces/PushControl.tsx";

const URI = "rnet://object/0198f2a1-b19c-77bb-a6e9-0d6c66c52ae3" as const;
const object = { uri: URI, type: "note", inferred: {}, source: { properties: {} } } as MediaObject;
function operation(result: unknown, committed_at?: string): OperationDocument {
  return {
    operation_id: "0198f2a1-e4cf-7add-99bc-3a9f99f85df7",
    kind: "push",
    status: "done",
    request: { mode: "push" },
    result,
    error: null,
    created_at: "2026-01-01T00:00:00Z",
    ...(committed_at ? { committed_at } : {}),
  } as OperationDocument;
}

describe("push host integration", () => {
  test("missing selection is unique and excludes inferred objects", () => {
    expect(missingObjectUris([object, object], PUSH_TASKS.object.display_name.name)).toEqual([URI]);
    expect(
      missingObjectUris(
        [{ ...object, inferred: { "rhizome:display_name": { model: "mock", properties: {} } } }],
        PUSH_TASKS.object.display_name.name,
      ),
    ).toEqual([]);
  });
  test("labels and Vibe views use generated inferred entries with fallbacks", () => {
    expect(inferredObjectLabel(object)).toBe(`note ${URI.split("/").at(-1)}`);
    expect(
      inferredObjectLabel({
        ...object,
        inferred: {
          "rhizome:display_name": { model: "mock", properties: { display_name: "Plan" } },
        },
      }),
    ).toBe("Plan");
    expect(
      resolveVibeView(
        {
          inferred: { "rhizome:vibe_view": { properties: { view: "datatable", config: {} } } },
        } as unknown as Vibe,
        [object],
      ),
    ).toBe("datatable");
  });
  test("terminal results invalidate every named object even without a commit", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const keys = [
      ["get", "/rnet/v0/objects/{id}", { params: { path: { id: URI.split("/").at(-1) } } }],
      ["get", "/rnet/v0/vibes/{id}", { params: { path: { id: "vibe" } } }],
    ];
    let reads = 0;
    const observer = new QueryObserver(client, {
      queryKey: keys[0]!,
      queryFn: async () => {
        reads += 1;
        return {};
      },
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await observer.refetch();
    client.setQueryData(keys[1]!, {});
    await invalidatePushResult(
      client,
      operation({
        level: "object",
        task: "display_name",
        model: null,
        llm_calls: 0,
        context: { truncated_objects: 0, truncated_pointers: 0, clipped_objects: 0 },
        abort_reason: null,
        objects: {
          selected: 1,
          sent: 1,
          written: 0,
          removed: 1,
          preserved_durable: 0,
          skipped: 0,
          failed: 0,
        },
        written: [],
        preserved: [],
        skipped: [{ uri: URI, reason: "not_applicable", removed: true }],
      }),
      "vibe",
    );
    expect(client.getQueryState(keys[1]!)?.isInvalidated).toBe(true);
    expect(reads).toBeGreaterThanOrEqual(2);
    unsubscribe();
  });
  test("element outcomes invalidate written, preserved, and skipped active queries", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ids = [
      "0198f2a1-c2ad-78cc-b7fa-1e7d77d63bf4",
      "0198f2a1-c2ad-78cc-b7fa-1e7d77d63bf5",
      "0198f2a1-c2ad-78cc-b7fa-1e7d77d63bf6",
    ];
    let reads = 0;
    const key = ["get", "/rnet/v0/elements/{id}", { params: { path: { id: ids[0] } } }];
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: async () => {
        reads += 1;
        return {};
      },
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await observer.refetch();
    for (const id of ids.slice(1)) {
      client.setQueryData(["get", "/rnet/v0/elements/{id}", { params: { path: { id } } }], {});
    }
    await invalidatePushResult(
      client,
      operation({
        level: "element",
        task: "element_task",
        model: null,
        llm_calls: 0,
        context: { truncated_objects: 0, truncated_pointers: 0, clipped_objects: 0 },
        abort_reason: null,
        elements: {
          selected: 3,
          sent: 2,
          written: 1,
          removed: 0,
          preserved_durable: 1,
          skipped: 1,
          failed: 0,
        },
        written: [{ uri: `rnet://element/${ids[0]}`, key: "rhizome:element_task", rev: 1 }],
        preserved: [`rnet://element/${ids[1]}`],
        skipped: [{ uri: `rnet://element/${ids[2]}`, reason: "unsupported_media" }],
      }),
      "vibe",
    );
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(
      ids
        .slice(1)
        .every(
          (id) =>
            client.getQueryState(["get", "/rnet/v0/elements/{id}", { params: { path: { id } } }])
              ?.isInvalidated === true,
        ),
    ).toBe(true);
    unsubscribe();
  });
});
