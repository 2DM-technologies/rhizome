import { Problem } from "../errors.ts";

export function schemaProblem(
  issues: readonly { instancePath?: string; schemaPath?: string; message: string }[],
  prefix = "",
): Problem {
  return new Problem(422, "schema_violation", "Schema violation", "The request does not conform", {
    errors: issues.map((issue) => ({
      pointer: `${prefix}${issue.instancePath ?? ""}` || "/",
      schema: issue.schemaPath,
      message: issue.message,
    })),
  });
}
