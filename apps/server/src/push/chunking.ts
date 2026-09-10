import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { JSONSchema } from "json-schema-to-ts";
import type { ModelConnectorRegistry } from "../inference/connector-registry.ts";
import { assertStructuredOutputSchema } from "../inference/structured-output-schema.ts";
import type { PushLimits } from "./limits.ts";
import type { PushTaskDefinition, TaskOutput } from "./task-catalog.ts";

const ajv = addFormats(new Ajv2020({ strict: true, allowUnionTypes: true }));

export function batchEnvelope(outputSchema: JSONSchema, refs: readonly string[]): JSONSchema {
  if (!refs.length || new Set(refs).size !== refs.length)
    throw new Error("Batch refs must be nonempty and unique");
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["results"],
    properties: {
      results: {
        type: "array",
        minItems: refs.length,
        maxItems: refs.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ref", "result"],
          properties: {
            ref: { type: "string", enum: refs },
            result: { anyOf: [outputSchema, { type: "null" }] },
          },
        },
      },
    },
  } as const satisfies JSONSchema;
  assertStructuredOutputSchema(schema);
  return schema;
}

/** Validate the whole batch and ref set before exposing any individual result for writing. */
export function unpackResults(
  outputSchema: JSONSchema,
  refs: readonly string[],
  output: unknown,
): Array<TaskOutput | null> {
  if (!ajv.compile(batchEnvelope(outputSchema, refs))(output))
    throw new Error("Invalid push batch output");
  const { results } = output as { results: Array<{ ref: string; result: TaskOutput | null }> };
  const byRef = new Map(results.map((item) => [item.ref, item.result]));
  if (byRef.size !== refs.length || refs.some((ref) => !byRef.has(ref)))
    throw new Error("Invalid push batch ref set");
  const validate = ajv.compile(outputSchema);
  for (const result of byRef.values())
    if (result !== null && !validate(result)) throw new Error("Invalid push task output");
  return refs.map((ref) => byRef.get(ref)!);
}

export async function packChunks<T>(
  records: readonly T[],
  task: PushTaskDefinition,
  registry: ModelConnectorRegistry,
  limits: PushLimits,
  inputFor: (records: readonly T[]) => string,
): Promise<{ chunks: T[][]; skipped: T[] }> {
  const chunks: T[][] = [];
  const skipped: T[] = [];
  const maximum = Math.min(
    task.maxObjectsPerCall ?? limits.maxObjectsPerCall,
    limits.maxObjectsPerCall,
  );
  let chunk: T[] = [];
  const fits = async (values: T[]) =>
    values.length <= maximum &&
    (await registry.connector.countTokens({
      target: registry.target,
      instructions: task.prompt,
      input: inputFor(values),
    })) <= limits.maxInputTokensPerCall;
  for (const record of records) {
    if (await fits([...chunk, record])) chunk.push(record);
    else {
      if (chunk.length) chunks.push(chunk);
      chunk = [];
      if (await fits([record])) chunk.push(record);
      else skipped.push(record);
    }
  }
  if (chunk.length) chunks.push(chunk);
  return { chunks, skipped };
}
