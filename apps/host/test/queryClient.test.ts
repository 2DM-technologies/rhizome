import { expect, test } from "bun:test";

import { createQueryClient } from "../src/queries/queryClient.ts";

test("immutable and payload queries do not refetch globally on focus", () => {
  expect(createQueryClient().getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false);
});

test("generated Problem responses retry only when the server failed", () => {
  const retry = createQueryClient().getDefaultOptions().queries?.retry;
  if (typeof retry !== "function") throw new Error("Expected a retry function");

  const problem = {
    type: "https://rhizome.tools/problems/not-found",
    title: "Not found",
    status: 404,
    detail: "The object does not exist",
    code: "not_found",
  } as const;

  expect(retry(0, problem)).toBe(false);
  expect(
    retry(0, {
      ...problem,
      type: "https://rhizome.tools/problems/internal-error",
      title: "Internal error",
      status: 500,
      code: "internal_error",
    }),
  ).toBe(true);
});
