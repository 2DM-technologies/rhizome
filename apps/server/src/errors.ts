import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { FromSchema, JSONSchema } from "json-schema-to-ts";

/**
 * The problem-code vocabulary. This is protocol-visible surface: clients branch on
 * `code`, and spec §4.4 requires a caller to be able to determine which scope was
 * missing or which rule failed. Keeping it closed means a typo fails response
 * validation instead of reaching a client, and the set shows up in the OpenAPI
 * document so a consumer can see what to expect.
 */
export const PROBLEM_CODES = [
  "authentication_required",
  "grant_missing",
  "ingest_nonconformant",
  "internal_error",
  "mime_required",
  "not_found",
  "not_implemented",
  "payload_too_large",
  "revision_conflict",
  "schema_violation",
  "writer_namespace_mismatch",
] as const;

export type ProblemCode = (typeof PROBLEM_CODES)[number];

/**
 * The single definition of an RFC 9457 problem document. Kept here as a plain schema
 * document rather than a compiled contract so that `errors.ts` imports nothing from
 * the route layer — `routes/contracts.ts` wraps this into `ProblemSchema`.
 *
 * `status` stays permissive (any 4xx/5xx) while `Problem`'s constructor keeps a tight
 * union: the schema also has to accept problems from code paths we have not enumerated.
 */
export const problemDocumentSchema = {
  type: "object",
  required: ["type", "title", "status", "detail", "code"],
  properties: {
    type: { type: "string", format: "uri" },
    title: { type: "string", minLength: 1 },
    status: { type: "integer", minimum: 400, maximum: 599 },
    detail: { type: "string" },
    code: { enum: PROBLEM_CODES },
  },
  additionalProperties: true,
} as const satisfies JSONSchema;

export type ProblemDocument = FromSchema<typeof problemDocumentSchema>;

export type ProblemStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 500 | 501;

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
