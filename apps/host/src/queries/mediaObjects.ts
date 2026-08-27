import { useQueryClient } from "@tanstack/react-query";

import { api } from "../api/client.ts";

const mediaObjectPath = "/rnet/v0/objects/{id}";

function mediaObjectQuery(uuid: string) {
  return api.queryOptions("get", mediaObjectPath, {
    params: { path: { id: uuid } },
  });
}

export function useMediaObject(uuid: string | undefined) {
  return api.useQuery(
    "get",
    mediaObjectPath,
    { params: { path: { id: uuid ?? "" } } },
    {
      enabled: Boolean(uuid),
      // This object is mutable in another tab; reconcile even inside global staleTime.
      refetchOnWindowFocus: "always",
    },
  );
}

/** Owner-mutable `user` properties. The MVP store applies writes last-write-wins. */
export function useSetMediaObjectUser() {
  const client = useQueryClient();
  const invalidateObject = (uuid: string) =>
    client.invalidateQueries({ queryKey: mediaObjectQuery(uuid).queryKey });

  return api.useMutation("patch", "/rnet/v0/objects/{id}/user", {
    // The mutation response can arrive after a newer overlapping write. Refetch the
    // authoritative object instead of installing a response whose ordering is unknown.
    onSuccess: (_response, { params }) => invalidateObject(params.path.id),
    onError: (_error, { params }) => invalidateObject(params.path.id),
  });
}

export function useSetMediaObjectInferred() {
  const client = useQueryClient();
  return api.useMutation("put", "/rnet/v0/objects/{id}/inferred", {
    onSuccess: (_response, { params }) =>
      client.invalidateQueries({
        queryKey: mediaObjectQuery(params.path.id).queryKey,
      }),
  });
}

/**
 * Creation accepts the generated multipart request directly (`{ body: FormData }`). The shared
 * owner builder constructs that body without redefining its metadata.
 */
export function useCreateMediaObjects() {
  const client = useQueryClient();
  return api.useMutation("post", "/rnet/v0/objects", {
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["get", "/rnet/v0/vibes"] }),
        client.invalidateQueries({ queryKey: ["get", "/rnet/v0/vibes/{id}"] }),
        client.invalidateQueries({ queryKey: ["get", "/rnet/v0/vibes/{id}/objects"] }),
      ]);
    },
  });
}
