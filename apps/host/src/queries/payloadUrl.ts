import { useEffect } from "react";

import { api } from "../api/client.ts";

const createObjectUrl = (blob: Blob) => URL.createObjectURL(blob);

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
      // An object URL is a handle to a blob held in memory, not a cacheable value.
      gcTime: 0,
      staleTime: Number.POSITIVE_INFINITY,
      refetchOnWindowFocus: false,
      select: createObjectUrl,
    },
  );

  // Revoking on unmount is the whole reason this is a hook: the blob stays resident until it
  // is released, so a gallery that mounted a hundred of these would hold a hundred payloads.
  const url = query.data;
  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  return query;
}
