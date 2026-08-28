import { useQueryClient } from "@tanstack/react-query";

import { api } from "../api/client.ts";
import { uuidOf } from "../api/uris.ts";

const mediaElementPath = "/rnet/v0/elements/{id}";

function mediaElementQueryKey(uuid: string) {
  return api.queryOptions("get", mediaElementPath, {
    params: { path: { id: uuid } },
  }).queryKey;
}

/**
 * Elements are what a person opens: a payload with a MIME type, one of five kinds. Kept apart
 * from origins on purpose — the protocol is emphatic that they are different things (an
 * upload is always an origin, never an element), and a shared "payload" abstraction would
 * quietly erase a distinction the spec exists to make.
 */
export function useMediaElement(uuid: string | undefined) {
  return api.useQuery(
    "get",
    mediaElementPath,
    { params: { path: { id: uuid ?? "" } } },
    { enabled: Boolean(uuid) },
  );
}

/** Detached elements are owner-only: the bytes go up as the request body, not as a form part. */
export function useCreateMediaElement() {
  const client = useQueryClient();
  return api.useMutation("post", "/rnet/v0/elements", {
    onSuccess: (element) => client.setQueryData(mediaElementQueryKey(uuidOf(element.uri)), element),
  });
}

export function useDeleteMediaElement() {
  const client = useQueryClient();
  return api.useMutation("delete", mediaElementPath, {
    onSuccess: (_response, { params }) =>
      client.removeQueries({ queryKey: mediaElementQueryKey(params.path.id) }),
  });
}
