import type { SourceSkillDefinition } from "../../../connected-sources/types.ts";
import { loadSimpleFinSettings, type SimpleFinSettings } from "./config.ts";
import { simpleFinSourceSkillManifest } from "./manifest.ts";
import { simpleFinParser } from "./parser.ts";
import { createSimpleFinSkill } from "./source.ts";

export const simpleFinSourceSkillDefinition = {
  skillId: simpleFinSourceSkillManifest.skill_id,
  parser: simpleFinParser,
  loadSettings: loadSimpleFinSettings,
  create: createSimpleFinSkill,
} satisfies SourceSkillDefinition<SimpleFinSettings>;
