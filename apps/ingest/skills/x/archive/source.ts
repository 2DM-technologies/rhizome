import type { FileSourceSkill } from "../../../file-sources/types.ts";
import { defineXCandidateBundle } from "../definition.ts";
import { xArchiveSourceSkillManifest } from "./manifest.ts";
import { xArchiveParser } from "./parser.ts";

export const xArchiveSourceSkill: FileSourceSkill = {
  manifest: xArchiveSourceSkillManifest,
  parser: xArchiveParser,
  compiledSource: defineXCandidateBundle(async ({ bytes, limits }) =>
    xArchiveParser.parse(bytes, limits),
  ),
};
