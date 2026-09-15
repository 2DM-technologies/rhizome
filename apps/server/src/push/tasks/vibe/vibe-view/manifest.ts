import type { JSONSchema } from "json-schema-to-ts";
import { PUSH_TASK_REFS } from "@rhizome/store-contract";
import type { PushTaskDefinition, TaskOutput } from "../../../task-catalog.ts";
import prompt from "./PROMPT.md" with { type: "text" };
import output from "./output.json";
import { chooseVibeView } from "./rules.ts";

const [datatable, mediaboard, simplelist, tweetfeed] = output.properties.config.anyOf;

// Keep each discriminator beside its config so strict generation cannot mix branches.
// The union is nested because the provider requires an object root without anyOf.
const modelOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["selection"],
  properties: {
    selection: {
      anyOf: Object.entries({ datatable, mediaboard, simplelist, tweetfeed }).map(
        ([view, config]) => ({
          type: "object",
          additionalProperties: false,
          required: ["view", "config"],
          properties: { view: { type: "string", enum: [view] }, config },
        }),
      ),
    },
  },
} as unknown as JSONSchema;

export const vibeView: PushTaskDefinition = {
  ...PUSH_TASK_REFS.vibeView,
  label: "Choose view",
  description: "Choose a display surface and configuration for the Vibe.",
  prompt,
  outputSchema: output as unknown as JSONSchema,
  modelOutput: {
    schema: modelOutputSchema,
    decode: (response) => response.selection as TaskOutput,
  },
  rules: chooseVibeView,
  effort: "low",
  outputTokens: { base: 1024, perObject: 0 },
};
