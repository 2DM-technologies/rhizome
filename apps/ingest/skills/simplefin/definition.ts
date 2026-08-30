import type { SourceSkillDefinition } from "../../connected-sources/types.ts";
import { loadSimpleFinSettings, type SimpleFinSettings } from "./config.ts";
import { SIMPLEFIN_SKILL_ID } from "./contracts.ts";
import { simpleFinParser } from "./scripts/parse-simplefin.ts";
import { createSimpleFinSkill } from "./source.ts";

export const simpleFinSourceSkillDefinition = {
  skillId: SIMPLEFIN_SKILL_ID,
  parser: simpleFinParser,
  loadSettings: loadSimpleFinSettings,
  create: createSimpleFinSkill,
} satisfies SourceSkillDefinition<SimpleFinSettings>;
