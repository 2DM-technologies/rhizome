import { useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { isPushOperation, type OperationDocument } from "@rhizome/store-contract";

import { api } from "../api/client.ts";
import { uuidOf } from "../api/uris.ts";
import { useOperation } from "./imports.ts";

const operationPath = "/rnet/v0/operations/{id}";

export function usePushVibe() {
  const client = useQueryClient();
  return api.useMutation("post", "/rnet/v0/vibes/{id}/push", {
    gcTime: 0,
    onSuccess: (operation) =>
      client.setQueryData(
        api.queryOptions("get", operationPath, {
          params: { path: { id: operation.operation_id } },
        }).queryKey,
        operation,
      ),
  });
}

export function invalidatePushResult(
  client: QueryClient,
  operation: OperationDocument,
  vibeUuid: string,
): Promise<unknown[]> {
  if (!["done", "failed", "aborted"].includes(operation.status) || !isPushOperation(operation)) {
    return Promise.resolve([]);
  }
  const result = operation.result;
  const uris =
    result && result.level !== "vibe"
      ? [
          ...new Set([
            ...result.written.map(({ uri }) => uri),
            ...result.preserved,
            ...result.skipped.map(({ uri }) => uri),
          ]),
        ]
      : [];
  return Promise.all([
    ...uris.map((uri) => {
      const kind = uri.startsWith("rnet://element/") ? "elements" : "objects";
      const path = kind === "elements" ? "/rnet/v0/elements/{id}" : "/rnet/v0/objects/{id}";
      return client.invalidateQueries({
        queryKey: api.queryOptions("get", path, {
          params: { path: { id: uuidOf(uri) } },
        }).queryKey,
      });
    }),
    client.invalidateQueries({
      queryKey: api.queryOptions("get", "/rnet/v0/vibes/{id}", {
        params: { path: { id: vibeUuid } },
      }).queryKey,
    }),
    client.invalidateQueries({
      queryKey: api.queryOptions("get", "/rnet/v0/vibes").queryKey,
    }),
    client.invalidateQueries({ queryKey: ["get", "/rnet/v0/vibes/{id}/objects"] }),
  ]);
}

export function usePushOperation(id: string | undefined, vibeUuid: string) {
  const client = useQueryClient();
  const operation = useOperation(id, vibeUuid);
  const refreshed = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      !operation.data ||
      !["done", "failed", "aborted"].includes(operation.data.status) ||
      refreshed.current === operation.data.operation_id
    )
      return;
    refreshed.current = operation.data.operation_id;
    void invalidatePushResult(client, operation.data, vibeUuid);
  }, [client, operation.data, vibeUuid]);
  return operation;
}
