import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client.ts";
import { uuidOf } from "../api/uris.ts";

/** Discover server-started work too; polling stops when this object surface unmounts. */
export function useObjectInferenceStatus(uuid: string, enabled: boolean) {
  const client = useQueryClient();
  const revisions = useRef(new Map<string, number>());
  const query = api.useQuery(
    "get",
    "/rnet/v0/objects/{id}/inference-status",
    {
      params: { path: { id: uuid } },
    },
    {
      enabled,
      refetchInterval: 1000,
      refetchOnWindowFocus: "always",
      gcTime: 0,
    },
  );
  useEffect(() => {
    for (const record of query.data?.records ?? []) {
      if (revisions.current.get(record.uri) === record.revision) continue;
      revisions.current.set(record.uri, record.revision);
      const path = record.uri.startsWith("rnet://object/")
        ? "/rnet/v0/objects/{id}"
        : "/rnet/v0/elements/{id}";
      void client.invalidateQueries({
        queryKey: api.queryOptions("get", path, { params: { path: { id: uuidOf(record.uri) } } })
          .queryKey,
      });
    }
  }, [client, query.data]);
  return query;
}
