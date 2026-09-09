import { defineTransactionFileSource } from "../definition.ts";
import { csvSourceSkillManifest } from "./manifest.ts";
import { csvParser } from "./parser.ts";

export const csvSourceSkill = defineTransactionFileSource(csvSourceSkillManifest, csvParser);
