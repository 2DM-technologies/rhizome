import type { ProblemDocument } from "@rhizome/store-contract";
import createFetchClient, { type Middleware } from "openapi-fetch";
import createQueryClient from "openapi-react-query";

import { bearerToken } from "../session/session.ts";
import { serializeRequestBody, StoreRequest } from "./bodySerializer.ts";
import type { paths } from "./generated/openapi.ts";

/** RFC 9457 problem document shared with the server's validating schema. */
export type { ProblemCode, ProblemDocument } from "@rhizome/store-contract";

/** A generated RFC 9457 response body, thrown by `openapi-react-query` on non-2xx responses. */
export type StoreError = ProblemDocument;

export function isStoreError(error: unknown): error is StoreError {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as Partial<ProblemDocument>;
  return (
    typeof candidate.type === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.status === "number" &&
    typeof candidate.detail === "string" &&
    typeof candidate.code === "string"
  );
}

const store: Middleware = {
  onRequest({ request }) {
    request.headers.set("Authorization", `Bearer ${bearerToken()}`);
    return request;
  },
};

const fetchClient = createFetchClient<paths>({
  baseUrl: import.meta.env.VITE_RHIZOME_API_URL ?? window.location.origin,
  bodySerializer: serializeRequestBody,
  Request: StoreRequest,
});

fetchClient.use(store);

/** Typed TanStack Query integration over the generated OpenAPI paths. */
export const api = createQueryClient(fetchClient);
