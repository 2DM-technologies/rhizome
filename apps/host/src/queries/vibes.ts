import { useQueryClient } from "@tanstack/react-query";

import { api } from "../api/client.ts";
import { uuidOf } from "../api/uris.ts";

const vibePath = "/rnet/v0/vibes/{id}";
const vibeObjectsPath = "/rnet/v0/vibes/{id}/objects";

function vibeQuery(uuid: string) {
  return api.queryOptions("get", vibePath, {
    params: { path: { id: uuid } },
  });
}

function vibeObjectsQuery(uuid: string) {
  return api.queryOptions("get", vibeObjectsPath, {
    params: { path: { id: uuid } },
  });
}

export function useVibes() {
  return api.useQuery("get", "/rnet/v0/vibes", undefined, {
    refetchOnWindowFocus: "always",
    select: (response) => response.vibes,
  });
}

export function useVibe(uuid: string | undefined) {
  return api.useQuery(
    "get",
    vibePath,
    { params: { path: { id: uuid ?? "" } } },
    {
      enabled: Boolean(uuid),
      refetchOnWindowFocus: "always",
    },
  );
}

/**
 * The Vibe's objects, in `vibe_media_objects.position` order — the store returns the whole
 * collection. The SDK surface specifies a page here, so this is deliberately shaped to become
 * paginated without moving the call sites.
 */
export function useVibeObjects(uuid: string | undefined) {
  return api.useQuery(
    "get",
    vibeObjectsPath,
    { params: { path: { id: uuid ?? "" } } },
    {
      enabled: Boolean(uuid),
      refetchOnWindowFocus: "always",
      select: (response) => response.mediaObjects,
    },
  );
}

export function useCreateVibe() {
  const client = useQueryClient();
  return api.useMutation("post", "/rnet/v0/vibes", {
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: api.queryOptions("get", "/rnet/v0/vibes").queryKey,
      }),
  });
}

export function useUpdateVibe() {
  const client = useQueryClient();
  return api.useMutation("patch", vibePath, {
    onSuccess: (vibe, request) => {
      client.setQueryData(vibeQuery(request.params.path.id).queryKey, vibe);
      void client.invalidateQueries({
        queryKey: api.queryOptions("get", "/rnet/v0/vibes").queryKey,
      });
    },
  });
}

export function useDeleteVibe() {
  const client = useQueryClient();
  return api.useMutation("delete", vibePath, {
    onSuccess: (_response, { params }) => {
      client.removeQueries({ queryKey: vibeQuery(params.path.id).queryKey });
      client.removeQueries({ queryKey: vibeObjectsQuery(params.path.id).queryKey });
      void client.invalidateQueries({
        queryKey: api.queryOptions("get", "/rnet/v0/vibes").queryKey,
      });
    },
  });
}

function useInvalidateVibeMembership() {
  const client = useQueryClient();
  return (uuid: string, objects: string[]) => {
    void client.invalidateQueries({ queryKey: vibeQuery(uuid).queryKey });
    void client.invalidateQueries({ queryKey: vibeObjectsQuery(uuid).queryKey });
    for (const uri of objects) {
      void client.invalidateQueries({
        queryKey: api.queryOptions("get", "/rnet/v0/objects/{id}", {
          params: { path: { id: uuidOf(uri) } },
        }).queryKey,
      });
    }
  };
}

export function useAddVibeObjects() {
  const invalidate = useInvalidateVibeMembership();
  return api.useMutation("post", vibeObjectsPath, {
    onSuccess: (_response, { body, params }) => invalidate(params.path.id, body.objects),
  });
}

export function useRemoveVibeObjects() {
  const invalidate = useInvalidateVibeMembership();
  return api.useMutation("delete", vibeObjectsPath, {
    onSuccess: (_response, { body, params }) => invalidate(params.path.id, body.objects),
  });
}
