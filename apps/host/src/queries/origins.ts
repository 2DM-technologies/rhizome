import { useQueryClient } from "@tanstack/react-query";

import { api } from "../api/client.ts";
import { uuidOf } from "../api/uris.ts";

const originArtifactPath = "/rnet/v0/origins/{id}";

function originArtifactQueryKey(uuid: string) {
  return api.queryOptions("get", originArtifactPath, {
    params: { path: { id: uuid } },
  }).queryKey;
}

/**
 * Origins are the raw bytes something was parsed from. Ontologically inert: not media, never
 * inside a Vibe, never model-consumed. They exist so ingestion can re-run against ground truth.
 *
 * Owner-only, and not delegable by any scope — a raw export is strictly more revealing than
 * the objects parsed out of it — which is why the dMachine SDK has no origin surface at all.
 */
export function useOriginArtifact(uuid: string | undefined) {
  return api.useQuery(
    "get",
    originArtifactPath,
    { params: { path: { id: uuid ?? "" } } },
    { enabled: Boolean(uuid) },
  );
}

export function useCreateOriginArtifact() {
  const client = useQueryClient();
  return api.useMutation("post", "/rnet/v0/origins", {
    onSuccess: (origin) => client.setQueryData(originArtifactQueryKey(uuidOf(origin.uri)), origin),
  });
}

export function useDeleteOriginArtifact() {
  const client = useQueryClient();
  return api.useMutation("delete", originArtifactPath, {
    onSuccess: (_response, { params }) =>
      client.removeQueries({ queryKey: originArtifactQueryKey(params.path.id) }),
  });
}
