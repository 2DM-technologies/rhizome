import { useEffect, useState } from "react";

import { api } from "../api/client.ts";

function useObjectUrl(blob: Blob | undefined): string | undefined {
  const [current, setCurrent] = useState<{ blob: Blob; url: string } | null>(null);

  useEffect(() => {
    if (!blob) {
      setCurrent(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    setCurrent({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  // Effects run after render. Never expose the preceding payload's URL during that gap when a
  // caller changes ids without unmounting.
  return current && current.blob === blob ? current.url : undefined;
}

/**
 * A displayable URL for a payload's bytes.
 *
 * Both `/elements/{id}/bytes` and `/origins/{id}/bytes` require `Authorization`, so an
 * `<img src={element.bytes}>` gets a 401 — the browser sends no bearer. The bytes are fetched
 * here instead and handed back as an object URL.
 *
 * This is a stopgap with a known replacement. The SDK surface specifies `elements.url()`
 * returning a short-lived signed URL, which keeps large media off the request path entirely;
 * the store has no signed-URL endpoint yet. When it does, this hook changes and its callers
 * do not.
 */
export function usePayloadUrl(kind: "elements" | "origins", uuid: string | undefined) {
  const path = kind === "elements" ? "/rnet/v0/elements/{id}/bytes" : "/rnet/v0/origins/{id}/bytes";
  const query = api.useQuery(
    "get",
    path,
    {
      params: { path: { id: uuid ?? "" } },
      parseAs: "blob",
    },
    {
      enabled: Boolean(uuid),
      gcTime: 0,
      staleTime: Number.POSITIVE_INFINITY,
      refetchOnWindowFocus: false,
    },
  );

  // Keep the fetched Blob in the query cache, but make the object URL component-owned. Query
  // selectors may reuse their result across observer lifecycles; a reused URL may already have
  // been revoked by the surface that created it.
  return { ...query, data: useObjectUrl(query.data) };
}

/** Fetch only the server's cached 64px image, never the original as a thumbnail fallback. */
export function useElementThumbnailUrl(uuid: string | undefined) {
  const query = api.useQuery(
    "get",
    "/rnet/v0/elements/{id}/thumbnail",
    { params: { path: { id: uuid ?? "" } }, parseAs: "blob" },
    {
      enabled: Boolean(uuid),
      gcTime: 0,
      staleTime: Number.POSITIVE_INFINITY,
      refetchOnWindowFocus: false,
      retry: false,
    },
  );
  return { ...query, data: useObjectUrl(query.data) };
}

/** A short-lived reviewed-import payload; authorization is inherited from the API client. */
export function useImportPreviewPayloadUrl(
  operationUuid: string | undefined,
  elementUuid: string | undefined,
) {
  const query = api.useQuery(
    "get",
    "/rnet/v0/operations/{id}/elements/{element_id}/bytes",
    {
      params: {
        path: { id: operationUuid ?? "", element_id: elementUuid ?? "" },
      },
      parseAs: "blob",
    },
    {
      enabled: Boolean(operationUuid && elementUuid),
      gcTime: 0,
      staleTime: Number.POSITIVE_INFINITY,
      refetchOnWindowFocus: false,
    },
  );

  return { ...query, data: useObjectUrl(query.data) };
}
