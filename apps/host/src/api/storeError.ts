import type { ProblemDocument } from "@rhizome/store-contract";

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
