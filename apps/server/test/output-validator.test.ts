import { expect, test } from "bun:test";
import { validateOutputSchema } from "../src/inference/output-validator.ts";

test("transient schemas and their compiler scopes are collectible", async () => {
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
  expect(references.filter((reference) => reference.deref()).length).toBe(0);
});
