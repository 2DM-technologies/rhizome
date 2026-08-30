import type { SourceSkillManifest } from "../../../packages/store-contract/src/source-skills.ts";

import { SourceSkillManifestCatalog } from "../connected-sources/types.ts";
import type { TransactionParser } from "../transactions/types.ts";

export interface FileSourceSkill {
  readonly manifest: SourceSkillManifest & { readonly source_kind: "file" };
  readonly parser: TransactionParser;
}

/** Executable file-source capabilities, keyed by stable skill identity rather than parser name. */
export class FileSourceCatalog {
  readonly #skills: readonly FileSourceSkill[];
  readonly #bySkillId: ReadonlyMap<string, FileSourceSkill>;
  readonly #manifests: readonly SourceSkillManifest[];

  constructor(values: readonly FileSourceSkill[]) {
    const manifestCatalog = new SourceSkillManifestCatalog(values.map((value) => value.manifest));
    const manifests = manifestCatalog.all();
    const bySkillId = new Map<string, FileSourceSkill>();
    const skills = values.map((value, index) => {
      const manifest = manifests[index];
      if (!manifest || manifest.source_kind !== "file") {
        throw new Error(`File source ${value.manifest.skill_id} has an incompatible manifest`);
      }
      if (
        manifest.parser.name !== value.parser.name ||
        manifest.parser.version !== value.parser.version
      ) {
        throw new Error(`File source ${manifest.skill_id} has inconsistent parser metadata`);
      }
      const skill = Object.freeze({ manifest, parser: value.parser }) as FileSourceSkill;
      bySkillId.set(manifest.skill_id, skill);
      return skill;
    });
    this.#skills = Object.freeze(skills);
    this.#bySkillId = bySkillId;
    this.#manifests = manifests;
  }

  all(): readonly FileSourceSkill[] {
    return this.#skills;
  }

  manifests(): readonly SourceSkillManifest[] {
    return this.#manifests;
  }

  forSkillId(skillId: string): FileSourceSkill | undefined {
    return this.#bySkillId.get(skillId);
  }
}
