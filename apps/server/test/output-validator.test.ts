import { expect, test } from "bun:test";
import { validateOutputSchema } from "../src/inference/output-validator.ts";

test("transient schemas and their compiler scopes do not accumulate after collection", async () => {
  const references: WeakRef<object>[] = [];
  function validateTransientSchemas() {
    for (let index = 0; index < 100; index++) {
      const schema = {
        type: "object",
        additionalProperties: false,
        required: ["ref"],
        properties: { ref: { type: "string", enum: [`ref-${index}`] } },
      } as const;
      references.push(new WeakRef(schema));
      expect(validateOutputSchema(schema, { ref: `ref-${index}` })).toBe(true);
      expect(validateOutputSchema(schema, { ref: "unexpected" })).toBe(false);
    }
  }
  validateTransientSchemas();
  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    Bun.gc(true);
  }
  // JavaScriptCore may conservatively retain its last temporary on a native stack.
  // The regression is accumulation across operations: the old shared compiler retained all 100.
  expect(references.filter((reference) => reference.deref()).length).toBeLessThanOrEqual(1);
});
