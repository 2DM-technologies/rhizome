import type {
  ImportPushPipeline,
  PushTaskReference,
  SourceSkillManifest,
} from "@rhizome/store-contract";

import type { PushTaskCatalog, PushTaskDefinition } from "./task-catalog.ts";

export interface CompiledImportPushPipelineNode {
  readonly key: string;
  readonly task: PushTaskDefinition;
  readonly after: readonly string[];
}

export interface CompiledImportPushPipeline {
  readonly skillId: string;
  /** Stable topological order; independent nodes retain manifest declaration order. */
  readonly nodes: readonly CompiledImportPushPipelineNode[];
}

/** Cross-catalog validation and compilation performed once during server construction. */
export class ImportPushPipelineCatalog {
  readonly #bySkillId: ReadonlyMap<string, CompiledImportPushPipeline>;

  constructor(manifests: readonly SourceSkillManifest[], tasks: PushTaskCatalog) {
    this.#bySkillId = new Map(
      manifests.map((manifest) => [
        manifest.skill_id,
        compileImportPushPipeline(manifest.skill_id, manifest.import_push_pipeline, tasks),
      ]),
    );
  }

  forSkillId(skillId: string): CompiledImportPushPipeline | undefined {
    return this.#bySkillId.get(skillId);
  }
}

export function compileImportPushPipeline(
  skillId: string,
  pipeline: ImportPushPipeline,
  tasks: PushTaskCatalog,
): CompiledImportPushPipeline {
  const declared = pipeline.map((node) => {
    const key = taskReferenceKey(node.task);
    const task = tasks.get(node.task.level, node.task.name);
    if (!task) {
      throw new Error(
        `Source-skill ${skillId} import push pipeline references missing task ${key}`,
      );
    }
    return { key, task, after: node.after.map(taskReferenceKey) };
  });
  const byKey = new Map<string, (typeof declared)[number]>();
  for (const node of declared) {
    if (byKey.has(node.key)) {
      throw new Error(`Source-skill ${skillId} import push pipeline repeats task ${node.key}`);
    }
    byKey.set(node.key, node);
  }
  for (const node of declared) {
    for (const dependency of node.after) {
      if (!byKey.has(dependency)) {
        throw new Error(
          `Source-skill ${skillId} import push pipeline task ${node.key} depends on undeclared task ${dependency}`,
        );
      }
    }
  }

  const emitted = new Set<string>();
  const ordered: typeof declared = [];
  while (ordered.length < declared.length) {
    const ready = declared.find(
      (node) => !emitted.has(node.key) && node.after.every((key) => emitted.has(key)),
    );
    if (!ready) {
      const cycle = declared.filter((node) => !emitted.has(node.key)).map(({ key }) => key);
      throw new Error(
        `Source-skill ${skillId} import push pipeline contains a cycle: ${cycle.join(", ")}`,
      );
    }
    emitted.add(ready.key);
    ordered.push(ready);
  }

  return Object.freeze({
    skillId,
    nodes: Object.freeze(
      ordered.map((node) => Object.freeze({ ...node, after: Object.freeze([...node.after]) })),
    ),
  });
}

function taskReferenceKey(reference: PushTaskReference): string {
  return `${reference.level}:${reference.name}`;
}
