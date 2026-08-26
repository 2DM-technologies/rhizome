import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { api, unwrap } from "../api/client.ts";
import type { OriginArtifact } from "../api/types.ts";
import { keys } from "./keys.ts";

/**
 * Origins are the raw bytes something was parsed from. Ontologically inert: not media, never
 * inside a Vibe, never model-consumed. They exist so ingestion can re-run against ground truth.
 *
 * Owner-only, and not delegable by any scope — a raw export is strictly more revealing than
 * the objects parsed out of it — which is why the dMachine SDK has no origin surface at all.
 */
export function useOriginArtifact(uuid: string | undefined): UseQueryResult<OriginArtifact> {
  return useQuery({
    queryKey: keys.origins.detail(uuid ?? ""),
    enabled: Boolean(uuid),
    queryFn: async () =>
      unwrap(await api.GET("/rnet/v0/origins/{id}", { params: { path: { id: uuid as string } } })),
  });
}

export interface CreateOriginInput {
  file: File;
  /** Optional human label, e.g. the original filename. */
  label?: string;
}

export function useCreateOriginArtifact() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, label }: CreateOriginInput) =>
      unwrap(
        await api.POST("/rnet/v0/origins", {
          params: { header: label ? { "x-rnet-label": label } : {} },
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
          bodySerializer: (body: Blob) => body,
        }),
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.origins.all }),
  });
}

export function useDeleteOriginArtifact() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (uuid: string) => {
      await api.DELETE("/rnet/v0/origins/{id}", { params: { path: { id: uuid } } });
      return uuid;
    },
    onSuccess: (uuid) => client.removeQueries({ queryKey: keys.origins.detail(uuid) }),
  });
}
