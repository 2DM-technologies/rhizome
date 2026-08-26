import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { api, unwrap } from "../api/client.ts";
import type { InferredEntry, MediaObject, PropertyBag } from "../api/types.ts";
import { keys } from "./keys.ts";

/**
 * An object together with the revision its `user` block is at.
 *
 * The two travel together because they are only useful together: a `user` write must send the
 * revision it read back as `If-Match`, and the store rejects a write that does not. The
 * revision arrives in the `ETag` header, so it cannot ride inside the document.
 */
export interface RevisionedMediaObject {
  readonly object: MediaObject;
  readonly userRev: number;
}

/**
 * `ETag: "3"` → `3`.
 *
 * Absence is a broken contract, not a zero: revision 0 is a real value for an object nobody
 * has written yet, so defaulting would send `If-Match: "0"` against a later revision and
 * either fail confusingly or, worse, look like it worked. The usual cause is a missing
 * `Access-Control-Expose-Headers`, which hides the header from JS while leaving it on the wire.
 */
function revisionOf(response: Response): number {
  const etag = response.headers.get("etag");
  if (etag === null) {
    throw new Error(
      "Response carried no readable ETag. Cross-origin callers need Access-Control-Expose-Headers: ETag.",
    );
  }
  const revision = Number(etag.replaceAll('"', ""));
  if (!Number.isInteger(revision)) throw new Error(`Malformed ETag revision: ${etag}`);
  return revision;
}

export function useMediaObject(uuid: string | undefined): UseQueryResult<RevisionedMediaObject> {
  return useQuery({
    queryKey: keys.objects.detail(uuid ?? ""),
    enabled: Boolean(uuid),
    queryFn: async () => {
      const result = await api.GET("/rnet/v0/objects/{id}", {
        params: { path: { id: uuid as string } },
      });
      return { object: unwrap(result), userRev: revisionOf(result.response) };
    },
  });
}

export interface SetUserInput {
  properties: PropertyBag;
  /** The revision this edit was made against. */
  ifMatch: number;
}

/**
 * Owner-mutable `user` properties, revision-protected.
 *
 * Deliberately not optimistic. A `user` write can lose to a concurrent one, and the store says
 * so with 409 `revision_conflict`; rolling an optimistic edit back after the fact would show
 * the user their own text vanishing. The mutation instead resolves to the store's document and
 * the caller surfaces the conflict — `isStoreError(error) && error.code === "revision_conflict"`
 * means someone else wrote, refetch and show them what changed.
 */
export function useSetMediaObjectUser(uuid: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ properties, ifMatch }: SetUserInput) => {
      const result = await api.PATCH("/rnet/v0/objects/{id}/user", {
        params: { path: { id: uuid }, header: { "if-match": `"${ifMatch}"` } },
        body: { properties },
      });
      return { object: unwrap(result), userRev: revisionOf(result.response) };
    },
    onSuccess: (revisioned) => client.setQueryData(keys.objects.detail(uuid), revisioned),
    onError: () => client.invalidateQueries({ queryKey: keys.objects.detail(uuid) }),
  });
}

export interface SetInferredInput {
  /** A bare task name. The store prefixes it with the authenticated writer's namespace. */
  task: string;
  entry: InferredEntry;
}

export function useSetMediaObjectInferred(uuid: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ task, entry }: SetInferredInput) =>
      unwrap(
        await api.PUT("/rnet/v0/objects/{id}/inferred", {
          params: { path: { id: uuid } },
          body: { task, entry },
        }),
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.objects.detail(uuid) }),
  });
}

export interface CreateMediaObjectsInput {
  /** Vibe URI the objects are created in. Required for a client; optional for an owner. */
  vibe?: string;
  objects: unknown[];
  /** File parts, keyed by the `upload` name each element reference points at. */
  uploads?: Record<string, File>;
}

/**
 * Creation is multipart: a JSON `metadata` part naming the objects, plus one file part per new
 * element. Objects, their new elements, the ordered references, and Vibe membership all commit
 * together, so there is no partial state to reconcile on failure.
 */
export function useCreateMediaObjects() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ vibe, objects, uploads = {} }: CreateMediaObjectsInput) => {
      const metadata = JSON.stringify(vibe ? { vibe, objects } : { objects });
      const result = await api.POST("/rnet/v0/objects", {
        body: { metadata, ...uploads },
        bodySerializer(body: { metadata: string } & Record<string, unknown>) {
          const form = new FormData();
          for (const [name, part] of Object.entries(body)) {
            form.append(name, part as string | File);
          }
          return form;
        },
      });
      return { vibe, mediaObjects: unwrap(result).mediaObjects };
    },
    onSuccess: ({ vibe }) => {
      if (!vibe) return;
      const uuid = vibe.slice(vibe.lastIndexOf("/") + 1);
      void client.invalidateQueries({ queryKey: keys.vibes.detail(uuid) });
      void client.invalidateQueries({ queryKey: keys.vibes.objects(uuid) });
    },
  });
}
