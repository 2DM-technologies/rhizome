import type { JSONSchema } from "json-schema-to-ts";
import { PUSH_TASK_REFS } from "@rhizome/store-contract";
import type { PushTaskDefinition } from "../../../task-catalog.ts";
import prompt from "./PROMPT.md" with { type: "text" };
import output from "./output.json";

export const describeMedia: PushTaskDefinition = {
  ...PUSH_TASK_REFS.describeMedia,
  label: "Describe media",
  description: "Describe each image and transcribe its legible text.",
  elementKinds: ["image"],
  prompt,
  outputSchema: output as JSONSchema,
  effort: "low",
  outputTokens: { base: 128, perObject: 1024 },
};
