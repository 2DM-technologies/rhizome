import createFetchClient, { type Middleware } from "openapi-fetch";
import createQueryClient from "openapi-react-query";

import { bearerToken } from "../session/session.ts";
import { serializeRequestBody, StoreRequest } from "./bodySerializer.ts";
import type { paths } from "./generated/openapi.ts";

export { isStoreError } from "./storeError.ts";
export type { ProblemCode, ProblemDocument, StoreError } from "./storeError.ts";

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
