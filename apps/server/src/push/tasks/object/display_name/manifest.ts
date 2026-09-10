import type { JSONSchema } from "json-schema-to-ts";
import type { PushTaskDefinition } from "../../../task-catalog.ts";
import prompt from "./PROMPT.md" with { type: "text" };
import output from "./output.json";

export const displayName: PushTaskDefinition = {
  name: "display_name",
  level: "object",
  label: "Display name",
  description: "Generate a short human-readable name for each object.",
  prompt,
  outputSchema: output as JSONSchema,
  effort: "low",
  outputTokens: { base: 128, perObject: 64 },
};
