import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { api, unwrap } from "../api/client.ts";
import type { MediaObject, Vibe } from "../api/types.ts";
import { uuidOf } from "../api/uris.ts";
import { keys } from "./keys.ts";

type VibeWritable = Pick<Vibe, "title" | "pull" | "grants">;

export function useVibes(): UseQueryResult<Vibe[]> {
  return useQuery({
    queryKey: keys.vibes.list(),
    queryFn: async () => unwrap(await api.GET("/rnet/v0/vibes")).vibes,
  });
}

export function useVibe(uuid: string | undefined): UseQueryResult<Vibe> {
  return useQuery({
    queryKey: keys.vibes.detail(uuid ?? ""),
    enabled: Boolean(uuid),
    queryFn: async () =>
      unwrap(await api.GET("/rnet/v0/vibes/{id}", { params: { path: { id: uuid as string } } })),
  });
}

/**
 * The Vibe's objects, in `vibe_media_objects.position` order — the store returns the whole
 * collection. The SDK surface specifies a page here, so this is deliberately shaped to become
 * paginated without moving the call sites.
 */
export function useVibeObjects(uuid: string | undefined): UseQueryResult<MediaObject[]> {
  return useQuery({
    queryKey: keys.vibes.objects(uuid ?? ""),
    enabled: Boolean(uuid),
    queryFn: async () =>
      unwrap(
        await api.GET("/rnet/v0/vibes/{id}/objects", {
          params: { path: { id: uuid as string } },
        }),
      ).mediaObjects,
  });
}

export function useCreateVibe() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: Pick<Vibe, "title"> & Partial<VibeWritable>) =>
      unwrap(await api.POST("/rnet/v0/vibes", { body })),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.vibes.list() }),
  });
}

export function useUpdateVibe(uuid: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: Partial<VibeWritable>) =>
      unwrap(await api.PATCH("/rnet/v0/vibes/{id}", { params: { path: { id: uuid } }, body })),
    onSuccess: (vibe) => {
      client.setQueryData(keys.vibes.detail(uuid), vibe);
      void client.invalidateQueries({ queryKey: keys.vibes.list() });
    },
  });
}

export function useDeleteVibe() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (uuid: string) => {
      await api.DELETE("/rnet/v0/vibes/{id}", { params: { path: { id: uuid } } });
      return uuid;
    },
    onSuccess: (uuid) => {
      client.removeQueries({ queryKey: keys.vibes.detail(uuid) });
      void client.invalidateQueries({ queryKey: keys.vibes.list() });
    },
  });
}

/** Membership changes alter the Vibe document and its object list, so both are invalidated. */
function useVibeMembership(uuid: string, method: "add" | "remove") {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (objects: string[]) => {
      const request = { params: { path: { id: uuid } }, body: { objects } };
      if (method === "add") await api.POST("/rnet/v0/vibes/{id}/objects", request);
      else await api.DELETE("/rnet/v0/vibes/{id}/objects", request);
      return objects;
    },
    onSuccess: (objects) => {
      void client.invalidateQueries({ queryKey: keys.vibes.detail(uuid) });
      void client.invalidateQueries({ queryKey: keys.vibes.objects(uuid) });
      for (const uri of objects) {
        void client.invalidateQueries({ queryKey: keys.objects.detail(uuidOf(uri)) });
      }
    },
  });
}

export const useAddVibeObjects = (uuid: string) => useVibeMembership(uuid, "add");
export const useRemoveVibeObjects = (uuid: string) => useVibeMembership(uuid, "remove");
