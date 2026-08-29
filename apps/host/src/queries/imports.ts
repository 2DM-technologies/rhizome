import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { api } from "../api/client.ts";

const operationPath = "/rnet/v0/operations/{id}";

function operationQuery(id: string) {
  return api.queryOptions("get", operationPath, { params: { path: { id } } });
}

export function useCreateIngestionSource() {
  return api.useMutation("post", "/rnet/v0/ingestion-sources");
}

export function useConnectSimpleFin() {
  return api.useMutation("post", "/rnet/v0/source-credentials/simplefin");
}

export function useCreateImportPreview() {
  const client = useQueryClient();
  return api.useMutation("post", "/rnet/v0/vibes/{id}/imports", {
    onSuccess: (operation) =>
      client.setQueryData(operationQuery(operation.operation_id).queryKey, operation),
  });
}

export function usePullVibe() {
  const client = useQueryClient();
  return api.useMutation("post", "/rnet/v0/vibes/{id}/pull", {
    onSuccess: (operation) =>
      client.setQueryData(operationQuery(operation.operation_id).queryKey, operation),
  });
}

export function useOperation(id: string | undefined, refreshVibeUuid?: string) {
  const client = useQueryClient();
  const refreshedOperation = useRef<string | undefined>(undefined);
  const query = api.useQuery(
    "get",
    operationPath,
    { params: { path: { id: id ?? "" } } },
    {
      enabled: Boolean(id),
      refetchInterval: (query) =>
        query.state.data && ["queued", "running"].includes(query.state.data.status) ? 250 : false,
    },
  );
  useEffect(() => {
    if (
      !refreshVibeUuid ||
      !query.data?.committed_at ||
      query.data.operation_id === refreshedOperation.current
    ) {
      return;
    }
    refreshedOperation.current = query.data.operation_id;
    void client.invalidateQueries({
      queryKey: api.queryOptions("get", "/rnet/v0/vibes").queryKey,
    });
    void client.invalidateQueries({
      queryKey: api.queryOptions("get", "/rnet/v0/vibes/{id}", {
        params: { path: { id: refreshVibeUuid } },
      }).queryKey,
    });
    void client.invalidateQueries({
      queryKey: api.queryOptions("get", "/rnet/v0/vibes/{id}/objects", {
        params: { path: { id: refreshVibeUuid } },
      }).queryKey,
    });
  }, [client, query.data?.committed_at, query.data?.operation_id, refreshVibeUuid]);
  return query;
}

export function useConfirmImportPreview() {
  const client = useQueryClient();
  return api.useMutation("post", "/rnet/v0/vibes/{id}/imports/{operation_id}/confirm", {
    onSuccess: (vibe, request) => {
      client.setQueryData(
        api.queryOptions("get", "/rnet/v0/vibes/{id}", {
          params: { path: { id: request.params.path.id } },
        }).queryKey,
        vibe,
      );
      void client.invalidateQueries({
        queryKey: api.queryOptions("get", "/rnet/v0/vibes").queryKey,
      });
      void client.invalidateQueries({
        queryKey: api.queryOptions("get", "/rnet/v0/vibes/{id}/objects", {
          params: { path: { id: request.params.path.id } },
        }).queryKey,
      });
      void client.invalidateQueries({
        queryKey: operationQuery(request.params.path.operation_id).queryKey,
      });
    },
  });
}
