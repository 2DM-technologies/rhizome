import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { JSONSchema } from "json-schema-to-ts";

const ajv = addFormats(new Ajv2020({ strict: true, allowUnionTypes: true }));
const validators = new WeakMap<object, ValidateFunction>();

/** Reuse live task schemas without retaining every operation's generated batch envelope. */
export function validateOutputSchema(schema: JSONSchema, output: unknown): boolean {
  if (typeof schema === "boolean") return schema;
  let validate = validators.get(schema);
  if (!validate) {
    try {
      validate = ajv.compile(schema);
      validators.set(schema, validate);
    } finally {
      // Ajv otherwise holds a strong reference even after the request is gone.
      ajv.removeSchema(schema);
    }
  }
  return validate(output) as boolean;
}
