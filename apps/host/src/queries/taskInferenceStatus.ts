import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { TaskInferenceStatusQuery } from "@rhizome/store-contract";
import type { MediaObject, Vibe } from "@rnet/types";
import { api } from "../api/client.ts";
import { uuidOf } from "../api/uris.ts";

/** Poll a task independently of who started it, and refresh the Vibe after inferred writes. */
export function useTaskInferenceStatus(
  uuid: string,
  task: TaskInferenceStatusQuery,
  enabled: boolean,
) {
  const client = useQueryClient();
  const seen = useRef<string | undefined>(undefined);
  const query = api.useQuery(
    "get",
    "/rnet/v0/vibes/{id}/inference-status",
    {
      params: { path: { id: uuid }, query: task },
    },
    { enabled, refetchInterval: 1000, refetchOnWindowFocus: "always", gcTime: 0 },
  );
  useEffect(() => {
    if (!query.data) return;
    const key = `${uuid}:${task.level}:${task.task}:${query.data.revision}:${query.data.status}`;
    if (seen.current === key) return;
    seen.current = key;
    // Record writes do not advance the Vibe revision. Task transitions also refresh
    // data after server-started runs, including partial writes followed by errors.
    const collection = client.getQueryData<{ mediaObjects: MediaObject[] }>(
      api.queryOptions("get", "/rnet/v0/vibes/{id}/objects", {
        params: { path: { id: uuid } },
      }).queryKey,
    );
    const elementUris = new Set(
      collection?.mediaObjects.flatMap((object) => object.elements.map((element) => element.uri)),
    );
    for (const uri of elementUris) {
      void client.invalidateQueries({
        queryKey: api.queryOptions("get", "/rnet/v0/elements/{id}", {
          params: { path: { id: uuidOf(uri) } },
        }).queryKey,
      });
    }
    void client.invalidateQueries({
      queryKey: api.queryOptions("get", "/rnet/v0/vibes/{id}/objects", {
        params: { path: { id: uuid } },
      }).queryKey,
    });
    const vibe = client.getQueryData<Vibe>(
      api.queryOptions("get", "/rnet/v0/vibes/{id}", {
        params: { path: { id: uuid } },
      }).queryKey,
    );
    for (const uri of vibe?.objects ?? []) {
      void client.invalidateQueries({
        queryKey: api.queryOptions("get", "/rnet/v0/objects/{id}", {
          params: { path: { id: uuidOf(uri) } },
        }).queryKey,
      });
    }
    void client.invalidateQueries({
      queryKey: api.queryOptions("get", "/rnet/v0/vibes/{id}", {
        params: { path: { id: uuid } },
      }).queryKey,
    });
    void client.invalidateQueries({
      queryKey: api.queryOptions("get", "/rnet/v0/vibes").queryKey,
    });
  }, [client, query.data, uuid, task.level, task.task]);
  return query;
}
