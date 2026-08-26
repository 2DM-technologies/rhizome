import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { api, unwrap } from "../api/client.ts";
import type { MediaElement } from "../api/types.ts";
import { keys } from "./keys.ts";

/**
 * Elements are what a person opens: a payload with a MIME type, one of five kinds. Kept apart
 * from origins on purpose — the protocol is emphatic that they are different things (an
 * upload is always an origin, never an element), and a shared "payload" abstraction would
 * quietly erase a distinction the spec exists to make.
 */
export function useMediaElement(uuid: string | undefined): UseQueryResult<MediaElement> {
  return useQuery({
    queryKey: keys.elements.detail(uuid ?? ""),
    enabled: Boolean(uuid),
    queryFn: async () =>
      unwrap(await api.GET("/rnet/v0/elements/{id}", { params: { path: { id: uuid as string } } })),
  });
}

export interface CreateMediaElementInput {
  file: File;
  kind: MediaElement["kind"];
}

/** Detached elements are owner-only: the bytes go up as the request body, not as a form part. */
export function useCreateMediaElement() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, kind }: CreateMediaElementInput) =>
      unwrap(
        await api.POST("/rnet/v0/elements", {
          params: { header: { "x-rnet-kind": kind } },
          headers: { "Content-Type": file.type },
          body: file,
          bodySerializer: (body: Blob) => body,
        }),
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.elements.all }),
  });
}

export function useDeleteMediaElement() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (uuid: string) => {
      await api.DELETE("/rnet/v0/elements/{id}", { params: { path: { id: uuid } } });
      return uuid;
    },
    onSuccess: (uuid) => client.removeQueries({ queryKey: keys.elements.detail(uuid) }),
  });
}
