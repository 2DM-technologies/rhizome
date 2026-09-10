import type { JSONSchema } from "json-schema-to-ts";

const keywords = new Set(
  "type enum const properties required additionalProperties items anyOf description pattern format minimum maximum exclusiveMinimum exclusiveMaximum multipleOf minItems maxItems".split(
    " ",
  ),
);
const formats = new Set("date-time date time duration email hostname ipv4 ipv6 uuid".split(" "));

/** Assert the authored schema directly; generation must never use a rewritten approximation. */
export function assertStructuredOutputSchema(schema: JSONSchema): void {
  if (typeof schema !== "object" || schema.type !== "object")
    throw new Error("Structured output requires an object root");
  function visit(value: JSONSchema, path: string): void {
    if (typeof value !== "object")
      throw new Error(`Structured output requires a schema object at ${path}`);
    for (const key of Object.keys(value)) {
      if (!keywords.has(key))
        throw new Error(`Unsupported structured-output keyword ${key} at ${path}`);
    }
    if (value.format !== undefined && !formats.has(value.format))
      throw new Error(`Unsupported format at ${path}`);
    const types = Array.isArray(value.type) ? value.type : [value.type];
    if (types.includes("object") || value.properties !== undefined) {
      if (
        !types.includes("object") ||
        value.additionalProperties !== false ||
        !value.properties ||
        !value.required
      )
        throw new Error(
          `Structured output objects must be closed and require every property at ${path}`,
        );
      const keys = Object.keys(value.properties);
      if (
        new Set(value.required).size !== keys.length ||
        value.required.length !== keys.length ||
        keys.some((key) => !value.required?.includes(key))
      )
        throw new Error(`Structured output must require every property at ${path}`);
      for (const [key, property] of Object.entries(value.properties))
        visit(property, `${path}/properties/${key}`);
    }
    if (types.includes("array") && !value.items)
      throw new Error(`Structured output array needs items at ${path}`);
    if (value.items !== undefined) {
      if (Array.isArray(value.items)) throw new Error(`Tuple items are unsupported at ${path}`);
      visit(value.items as JSONSchema, `${path}/items`);
    }
    for (const [index, branch] of (value.anyOf ?? []).entries())
      visit(branch, `${path}/anyOf/${index}`);
  }
  visit(schema, "");
}
