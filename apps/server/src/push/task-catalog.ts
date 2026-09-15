import { PUSH_TASK_LEVELS, storeTaskKey, type PushTaskManifest } from "@rhizome/store-contract";
import type { MediaElement } from "@rnet/types";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { JSONSchema } from "json-schema-to-ts";
import type { BlobStore } from "../blobs/types.ts";
import type { CompletionRequest } from "../inference/model-connector.ts";
import { assertStructuredOutputSchema } from "../inference/structured-output-schema.ts";
import type { ContextObject, VibeContext } from "./context.ts";

export type TaskOutput = Record<string, unknown>;
export interface PrepareVibeContextInput {
  vibeUuid: string;
  records: readonly ContextObject[];
  blobs: BlobStore;
  signal: AbortSignal;
}
export interface PushTaskDefinition {
  name: string;
  level: (typeof PUSH_TASK_LEVELS)[number];
  label: string;
  description: string;
  elementKinds?: MediaElement["kind"][];
  prompt: string;
  outputSchema: JSONSchema;
  /** Semantic constraints that the provider's JSON Schema subset cannot express. */
  validateOutput?: (output: TaskOutput) => boolean;
  rules?: (context: VibeContext) => TaskOutput | undefined;
  /** Bounded deterministic data gathered inside the push operation before a Vibe call. */
  prepareVibeContext?: (input: PrepareVibeContextInput) => Promise<Record<string, unknown>>;
  /** Task-owned normalization applied before the ordinary schema and policy checks. */
  transformVibeOutput?: (output: TaskOutput, context: VibeContext) => TaskOutput;
  effort: CompletionRequest["effort"];
  maxObjectsPerCall?: number;
  outputTokens: { base: number; perObject: number };
}

export function toManifest(task: PushTaskDefinition): PushTaskManifest {
  return {
    level: task.level,
    name: task.name,
    label: task.label,
    description: task.description,
    output_schema: task.outputSchema as Record<string, unknown>,
  };
}

export class PushTaskCatalog {
  private readonly tasks = new Map<string, PushTaskDefinition>();

  constructor(definitions: readonly PushTaskDefinition[]) {
    const ajv = addFormats(new Ajv2020({ strict: true, allowUnionTypes: true }));
    for (const task of definitions) {
      storeTaskKey(task.name);
      if (!PUSH_TASK_LEVELS.includes(task.level)) throw new Error("Invalid push task level");
      const key = `${task.level}:${task.name}`;
      if (this.tasks.has(key)) throw new Error(`Duplicate push task: ${key}`);
      if (!task.prompt.trim()) throw new Error(`Empty push prompt: ${key}`);
      if (task.rules && task.level !== "vibe") throw new Error("Rules require a Vibe task");
      if ((task.prepareVibeContext || task.transformVibeOutput) && task.level !== "vibe")
        throw new Error("Vibe context hooks require a Vibe task");
      if (
        task.level === "element"
          ? !task.elementKinds?.length || task.elementKinds.some((kind) => kind !== "image")
          : task.elementKinds !== undefined
      )
        throw new Error("Element tasks must declare supported image elementKinds only");
      assertStructuredOutputSchema(task.outputSchema);
      ajv.compile(task.outputSchema);
      this.tasks.set(key, task);
    }
  }

  get(level: PushTaskDefinition["level"], name: string): PushTaskDefinition | undefined {
    return this.tasks.get(`${level}:${name}`);
  }

  manifests(): PushTaskManifest[] {
    return [...this.tasks.values()].map(toManifest);
  }
}
