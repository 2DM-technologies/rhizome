import type { JSONSchema } from "json-schema-to-ts";
import type { PushTaskDefinition } from "../../../task-catalog.ts";
import prompt from "./PROMPT.md" with { type: "text" };
import output from "./output.json";
import { chooseVibeView } from "./rules.ts";

export const vibeView: PushTaskDefinition = {
  name: "vibe_view",
  level: "vibe",
  label: "Choose view",
  description: "Choose a display surface and configuration for the Vibe.",
  prompt,
  outputSchema: output as unknown as JSONSchema,
  rules: chooseVibeView,
  effort: "low",
  outputTokens: { base: 1024, perObject: 0 },
};
