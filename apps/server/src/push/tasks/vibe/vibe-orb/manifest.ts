import type { JSONSchema } from "json-schema-to-ts";
import { PUSH_TASK_REFS } from "@rhizome/store-contract";
import type { PushTaskDefinition } from "../../../task-catalog.ts";
import prompt from "./PROMPT.md" with { type: "text" };
import output from "./output.json";
import { prepareVibeOrbContext, deriveVibeOrb } from "./palette.ts";

export const vibeOrb: PushTaskDefinition = {
  ...PUSH_TASK_REFS.vibeOrb,
  label: "Shape orb",
  description:
    "Derive the Vibe's procedural identity by combining its media objects’ visual identities.",
  prompt,
  outputSchema: output as JSONSchema,
  prepareVibeContext: prepareVibeOrbContext,
  rules: deriveVibeOrb,
  effort: "low",
  outputTokens: { base: 0, perObject: 0 },
};
