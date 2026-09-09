import type { ProblemCode, ProblemDocument } from "@rhizome/store-contract";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

export { PROBLEM_CODES, problemDocumentSchema } from "@rhizome/store-contract";
export type { ProblemCode, ProblemDocument } from "@rhizome/store-contract";

/** Statuses raised intentionally by the Hono server implementation. */
export type ProblemStatus = 400 | 401 | 403 | 404 | 413 | 415 | 422 | 429 | 500 | 501;

export class Problem extends HTTPException {
  constructor(
    status: ProblemStatus,
    readonly code: ProblemCode,
    readonly title: string,
    readonly detail: string,
    readonly extensions: Record<string, unknown> = {},
  ) {
    super(status, { message: detail });
  }
}

export function problemResponse(c: Context, problem: Problem): Response {
  // Annotated so the serializer is checked against the schema at compile time rather
  // than surfacing as a 500 from response validation. `type` is derived from `code`;
  // this is the only place that derivation lives.
  const body: ProblemDocument = {
    type: `https://rnet.network/problems/${problem.code}`,
    title: problem.title,
    status: problem.status,
    detail: problem.detail,
    code: problem.code,
    ...problem.extensions,
  };
  return c.json(body, problem.status, { "Content-Type": "application/problem+json" });
}

export function notFound(kind: string): Problem {
  return new Problem(404, "not_found", "Not found", `${kind} does not exist`);
}

export function authenticationRequired(): Problem {
  return new Problem(
    401,
    "authentication_required",
    "Authentication required",
    "Sign in to continue",
  );
}

export function grantMissing(scope: string): Problem {
  return new Problem(403, "grant_missing", "Grant missing", `The ${scope} scope is required`, {
    scope,
  });
}
