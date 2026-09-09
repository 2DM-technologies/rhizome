import { beforeEach, expect, mock, test } from "bun:test";

const actualReactQuery = { ...(await import("@tanstack/react-query")) };
const actualClient = { ...(await import("../src/api/client.ts")) };

const invalidateQueries = mock(async () => undefined);
const removeQueries = mock(() => undefined);
const setQueryData = mock((_queryKey: unknown, _updater?: unknown) => undefined);
const useQuery = mock(
  (_method: string, _path: string, _request: unknown, options: unknown) => options,
);
const useMutation = mock((_method: string, _path: string, options: unknown) => options);
const queryOptions = mock((method: string, path: string, request?: unknown) => ({
  queryKey: request === undefined ? [method, path] : [method, path, request],
}));

mock.module("@tanstack/react-query", () => ({
  ...actualReactQuery,
  useQueryClient: () => ({ invalidateQueries, removeQueries, setQueryData }),
}));

mock.module("../src/api/client.ts", () => ({
  ...actualClient,
  api: { queryOptions, useMutation, useQuery },
}));

const { useMediaObject, useSetMediaObjectUser } = await import("../src/queries/mediaObjects.ts");
const { useAddVibeObjects, useDeleteVibe } = await import("../src/queries/vibes.ts");

beforeEach(() => {
  invalidateQueries.mockClear();
  removeQueries.mockClear();
  setQueryData.mockClear();
  useQuery.mockClear();
  useMutation.mockClear();
  queryOptions.mockClear();
});

test("set-user success refetches the authoritative object instead of caching its response", async () => {
  const mutation = useSetMediaObjectUser() as unknown as {
    onSuccess: (
      data: unknown,
      request: {
        params: { path: { id: string } };
        body: { properties: Record<string, unknown> };
      },
    ) => Promise<void>;
  };

  await mutation.onSuccess(
    {},
    {
      params: { path: { id: "object-1" } },
      body: { properties: { title: "newest" } },
    },
  );

  expect(invalidateQueries).toHaveBeenCalledWith({
    queryKey: ["get", "/rnet/v0/objects/{id}", { params: { path: { id: "object-1" } } }],
  });
  expect(invalidateQueries).toHaveBeenCalledWith({
    queryKey: ["get", "/rnet/v0/vibes/{id}/objects"],
  });
  expect(setQueryData).not.toHaveBeenCalled();
});

test("media objects reconcile another tab's write on every focus", () => {
  const query = useMediaObject("object-1") as unknown as {
    refetchOnWindowFocus: unknown;
  };

  expect(query.refetchOnWindowFocus).toBe("always");
});

test("deleting a Vibe clears its queries and immediately removes it from search data", () => {
  const mutation = useDeleteVibe() as unknown as {
    onSuccess: (data: unknown, request: { params: { path: { id: string } } }) => void;
  };

  const retainedVibe = { uri: "rnet://vibe/vibe-2", title: "Retained" };
  const deletedVibe = { uri: "rnet://vibe/vibe-1", title: "Deleted" };
  mutation.onSuccess(null, { params: { path: { id: "vibe-1" } } });

  expect(removeQueries).toHaveBeenCalledTimes(2);
  expect(removeQueries).toHaveBeenCalledWith({
    queryKey: ["get", "/rnet/v0/vibes/{id}", { params: { path: { id: "vibe-1" } } }],
  });
  expect(removeQueries).toHaveBeenCalledWith({
    queryKey: ["get", "/rnet/v0/vibes/{id}/objects", { params: { path: { id: "vibe-1" } } }],
  });
  expect(setQueryData).toHaveBeenCalledWith(["get", "/rnet/v0/vibes"], expect.any(Function));
  const update = setQueryData.mock.calls[0]?.[1] as (current: {
    vibes: Array<{ uri: string; title: string }>;
  }) => { vibes: Array<{ uri: string; title: string }> };
  expect(update({ vibes: [retainedVibe, deletedVibe] })).toEqual({ vibes: [retainedVibe] });
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["get", "/rnet/v0/vibes"] });
});

test("membership changes refresh the global Vibe collection", () => {
  const mutation = useAddVibeObjects() as unknown as {
    onSuccess: (
      data: unknown,
      request: { params: { path: { id: string } }; body: { objects: string[] } },
    ) => void;
  };

  mutation.onSuccess(null, {
    params: { path: { id: "vibe-1" } },
    body: { objects: ["rnet://object/0198f2a1-b19c-77bb-a6e9-0d6c66c52ae3"] },
  });

  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["get", "/rnet/v0/vibes"] });
});
