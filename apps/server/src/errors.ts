import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

export class Problem extends HTTPException {
  constructor(
    status: 400 | 401 | 403 | 404 | 409 | 415 | 422 | 500 | 501,
    readonly code: string,
    readonly title: string,
    readonly detail: string,
    readonly extensions: Record<string, unknown> = {},
  ) {
    super(status, { message: detail });
  }
}

export function problemResponse(c: Context, problem: Problem): Response {
  return c.json(
    {
      type: `https://rnet.network/problems/${problem.code}`,
      title: problem.title,
      status: problem.status,
      detail: problem.detail,
      code: problem.code,
      ...problem.extensions,
    },
    problem.status,
    { "Content-Type": "application/problem+json" },
  );
}

export function notFound(kind: string): Problem {
  return new Problem(404, "not_found", "Not found", `${kind} does not exist`);
}

export function grantMissing(scope: string): Problem {
  return new Problem(403, "grant_missing", "Grant missing", `The ${scope} scope is required`, { scope });
}
