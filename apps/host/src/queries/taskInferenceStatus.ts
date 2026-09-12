import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { TaskInferenceStatusQuery } from "@rhizome/store-contract";
import { api } from "../api/client.ts";

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
    const key = `${uuid}:${query.data.revision}`;
    if (seen.current === key) return;
    seen.current = key;
    void client.invalidateQueries({
      queryKey: api.queryOptions("get", "/rnet/v0/vibes/{id}", {
        params: { path: { id: uuid } },
      }).queryKey,
    });
  }, [client, query.data, uuid]);
  return query;
}
