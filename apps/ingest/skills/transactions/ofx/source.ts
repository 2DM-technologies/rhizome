import { defineTransactionFileSource } from "../definition.ts";
import { ofxSourceSkillManifest } from "./manifest.ts";
import { ofxParser } from "./parser.ts";

export const ofxSourceSkill = defineTransactionFileSource(ofxSourceSkillManifest, ofxParser);
