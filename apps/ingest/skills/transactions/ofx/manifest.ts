import type { SourceSkillManifest } from "../../../../../packages/store-contract/src/source-skills.ts";

import { ofxParser } from "./parser.ts";

export const ofxSourceSkillManifest = {
  skill_id: "ofx",
  label: "QFX / OFX transactions",
  description: "Choose a QFX or OFX bank export and review it before importing.",
  source_kind: "file",
  connector_version: "origin-upload@1.0.0",
  parser: { name: ofxParser.name, version: ofxParser.version },
  input_fields: [
    {
      name: "file",
      label: "QFX or OFX transaction export",
      target: "source",
      control: "file",
      required: true,
      secret: false,
      accept: [".qfx", ".ofx", "application/x-ofx"],
    },
  ],
  review_actions: ["review_import"],
} as const satisfies SourceSkillManifest;
