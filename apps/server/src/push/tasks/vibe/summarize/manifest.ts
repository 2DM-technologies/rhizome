import type { JSONSchema } from "json-schema-to-ts";
import type { PushTaskDefinition } from "../../../task-catalog.ts";
import prompt from "./PROMPT.md" with { type: "text" };
import output from "./output.json";

export const summarize: PushTaskDefinition = {
  name: "summarize",
  level: "vibe",
  label: "Summarize",
  description: "Summarize the Vibe's contents and themes.",
  prompt,
  outputSchema: output as JSONSchema,
  effort: "low",
  outputTokens: { base: 1024, perObject: 0 },
};
