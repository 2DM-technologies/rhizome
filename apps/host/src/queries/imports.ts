import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { api } from "../api/client.ts";

const operationPath = "/rnet/v0/operations/{id}";
const sourceCredentialPath = "/rnet/v0/source-credentials/{skill_id}";
const sourceSkillsPath = "/rnet/v0/source-skills";

function operationQuery(id: string) {
  return api.queryOptions("get", operationPath, { params: { path: { id } } });
}

export function useCreateIngestionSource() {
  return api.useMutation("post", "/rnet/v0/ingestion-sources");
}

/** The serializable capabilities used to render provider-neutral source forms. */
export function useSourceSkills() {
  return api.useQuery("get", sourceSkillsPath, undefined, {
    select: (response) => response.skills,
  });
}

/** Connects any installed credentialed source through its generated `skill_id` path parameter. */
export function useConnectSourceCredential() {
  return api.useMutation("post", sourceCredentialPath, { gcTime: 0 });
}

export function useCreateImportPreview() {
  const client = useQueryClient();
  return api.useMutation("post", "/rnet/v0/vibes/{id}/imports", {
    gcTime: 0,
    onSuccess: (operation) =>
      client.setQueryData(operationQuery(operation.operation_id).queryKey, operation),
  });
}

export function useCreatePendingVibeImportPreview() {
  const client = useQueryClient();
  return api.useMutation("post", "/rnet/v0/imports", {
    gcTime: 0,
    onSuccess: (operation) =>
      client.setQueryData(operationQuery(operation.operation_id).queryKey, operation),
  });
}

export function usePullVibe() {
  const client = useQueryClient();
  return api.useMutation("post", "/rnet/v0/vibes/{id}/pull", {
    gcTime: 0,
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
      // Owner operation results can contain a short-lived continuation bearer. Do not retain
      // them after the surface stops observing the operation.
      gcTime: 0,
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

/** Removes an operation result immediately after its continuation bearer has been consumed. */
export function useForgetOperation() {
  const client = useQueryClient();
  return useCallback(
    (id: string) => client.removeQueries({ queryKey: operationQuery(id).queryKey, exact: true }),
    [client],
  );
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

export function useConfirmPendingVibeImportPreview() {
  const client = useQueryClient();
  return api.useMutation("post", "/rnet/v0/imports/{operation_id}/confirm", {
    onSuccess: (vibe) => {
      client.setQueryData(
        api.queryOptions("get", "/rnet/v0/vibes/{id}", {
          params: { path: { id: vibe.uri.split("/").at(-1)! } },
        }).queryKey,
        vibe,
      );
      void client.invalidateQueries({
        queryKey: api.queryOptions("get", "/rnet/v0/vibes").queryKey,
      });
    },
  });
}
