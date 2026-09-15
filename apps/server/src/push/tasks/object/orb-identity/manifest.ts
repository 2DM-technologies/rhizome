import type { JSONSchema } from "json-schema-to-ts";
import { PUSH_TASK_REFS } from "@rhizome/store-contract";
import type { PushTaskDefinition } from "../../../task-catalog.ts";
import prompt from "./PROMPT.md" with { type: "text" };
import output from "./output.json";

export const orbIdentity: PushTaskDefinition = {
  ...PUSH_TASK_REFS.orbIdentity,
  label: "Orb identity",
  description:
    "Give each media object a reusable palette, pattern, glass depth, and motion character.",
  prompt,
  outputSchema: output as JSONSchema,
  effort: "low",
  maxObjectsPerCall: 12,
  outputTokens: { base: 128, perObject: 512 },
};
