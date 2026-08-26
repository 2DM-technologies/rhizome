import createClient, { type Middleware } from "openapi-fetch";

import { bearerToken } from "../session/session.ts";
import type { components, paths } from "./generated/openapi.ts";

/** RFC 9457 problem document. Generated from the store's own schema, codes and all. */
export type ProblemDocument = components["schemas"]["Problem"];
export type ProblemCode = ProblemDocument["code"];

/**
 * A problem response, raised. `openapi-fetch` reports failures as a returned `error` and
 * never throws; TanStack Query decides success by whether a function throws. Converting once
 * here keeps that four-line dance out of every hook.
 */
export class StoreError extends Error {
  constructor(readonly problem: ProblemDocument) {
    super(problem.detail);
    this.name = "StoreError";
  }

  /** Narrowed to the store's closed vocabulary, so callers can branch exhaustively. */
  get code(): ProblemCode {
    return this.problem.code;
  }

  get status(): number {
    return this.problem.status;
  }
}

export function isStoreError(error: unknown): error is StoreError {
  return error instanceof StoreError;
}

/**
 * The body of a response that must have one. Unreachable in practice — the middleware throws
 * before a caller sees a failure — but `openapi-fetch` types `data` as optional because it
 * cannot know that, and asserting it once here beats a non-null assertion in every hook.
 */
export function unwrap<Value>(result: { data?: Value }): Value {
  if (result.data === undefined) throw new Error("Store returned no body");
  return result.data;
}

const store: Middleware = {
  onRequest({ request }) {
    request.headers.set("Authorization", `Bearer ${bearerToken()}`);
    return request;
  },
  async onResponse({ response }) {
    if (response.ok) return response;
    if (response.headers.get("Content-Type")?.includes("problem+json")) {
      throw new StoreError((await response.clone().json()) as ProblemDocument);
    }
    throw new Error(`Store request failed: ${response.status} ${response.statusText}`);
  },
};

export const api = createClient<paths>({
  baseUrl: import.meta.env.VITE_RHIZOME_API_URL ?? window.location.origin,
});

api.use(store);
