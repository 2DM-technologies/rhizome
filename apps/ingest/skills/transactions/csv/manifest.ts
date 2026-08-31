import type { SourceSkillManifest } from "../../../../../packages/store-contract/src/source-skills.ts";

import { csvParser } from "./parser.ts";

export const csvSourceSkillManifest = {
  skill_id: "csv",
  label: "CSV transactions",
  description: "Choose a supported CSV transaction export and review it before importing.",
  source_kind: "file",
  connector_version: "origin-upload@1.0.0",
  parser: { name: csvParser.name, version: csvParser.version },
  input_fields: [
    {
      name: "file",
      label: "CSV transaction export",
      target: "source",
      control: "file",
      required: true,
      secret: false,
      accept: [".csv", "text/csv"],
    },
  ],
  review_actions: ["review_import"],
} as const satisfies SourceSkillManifest;
