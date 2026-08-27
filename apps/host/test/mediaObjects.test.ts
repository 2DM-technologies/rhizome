import { beforeEach, expect, mock, test } from "bun:test";

const invalidateQueries = mock(async () => undefined);
const removeQueries = mock(() => undefined);
const setQueryData = mock(() => undefined);
const useQuery = mock(
  (_method: string, _path: string, _request: unknown, options: unknown) => options,
);
const useMutation = mock((_method: string, _path: string, options: unknown) => options);
const queryOptions = mock((method: string, path: string, request?: unknown) => ({
  queryKey: request === undefined ? [method, path] : [method, path, request],
}));

mock.module("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries, removeQueries, setQueryData }),
}));

mock.module("../src/api/client.ts", () => ({
  api: { queryOptions, useMutation, useQuery },
}));

const { useMediaObject, useSetMediaObjectUser } = await import("../src/queries/mediaObjects.ts");
const { useDeleteVibe } = await import("../src/queries/vibes.ts");

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
  expect(setQueryData).not.toHaveBeenCalled();
});

test("media objects reconcile another tab's write on every focus", () => {
  const query = useMediaObject("object-1") as unknown as {
    refetchOnWindowFocus: unknown;
  };

  expect(query.refetchOnWindowFocus).toBe("always");
});

test("deleting a Vibe clears both its document and object collection", () => {
  const mutation = useDeleteVibe() as unknown as {
    onSuccess: (data: unknown, request: { params: { path: { id: string } } }) => void;
  };

  mutation.onSuccess(null, { params: { path: { id: "vibe-1" } } });

  expect(removeQueries).toHaveBeenCalledTimes(2);
  expect(removeQueries).toHaveBeenCalledWith({
    queryKey: ["get", "/rnet/v0/vibes/{id}", { params: { path: { id: "vibe-1" } } }],
  });
  expect(removeQueries).toHaveBeenCalledWith({
    queryKey: ["get", "/rnet/v0/vibes/{id}/objects", { params: { path: { id: "vibe-1" } } }],
  });
});
