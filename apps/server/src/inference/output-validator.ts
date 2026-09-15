import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { JSONSchema } from "json-schema-to-ts";

const validators = new WeakMap<object, ValidateFunction>();

/** Reuse live task schemas without retaining every operation's generated batch envelope. */
export function validateOutputSchema(schema: JSONSchema, output: unknown): boolean {
  if (typeof schema === "boolean") return schema;
  let validate = validators.get(schema);
  if (!validate) {
    // Ajv's generated-code scope retains compiled schemas even after removeSchema().
    // Keep the whole compiler within this weak entry's lifetime so that scope can be collected.
    const ajv = addFormats(new Ajv2020({ strict: true, allowUnionTypes: true }));
    validate = ajv.compile(schema);
    validators.set(schema, validate);
  }
  return validate(output) as boolean;
}
