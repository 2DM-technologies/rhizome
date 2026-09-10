import type { JSONSchema } from "json-schema-to-ts";
import type { PushTaskDefinition } from "../../../task-catalog.ts";
import prompt from "./PROMPT.md" with { type: "text" };
import output from "./output.json";

export const searchKeywords: PushTaskDefinition = {
  name: "search_keywords",
  level: "object",
  label: "Search keywords",
  description: "Generate grounded terms for lexical search.",
  prompt,
  outputSchema: output as JSONSchema,
  effort: "low",
  outputTokens: { base: 128, perObject: 512 },
};
