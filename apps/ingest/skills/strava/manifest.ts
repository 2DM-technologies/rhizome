import type { SourceSkillManifest } from "../../../../packages/store-contract/src/source-skills.ts";
import { STRAVA_LIMITS, STRAVA_PARSER_NAME, STRAVA_PARSER_VERSION } from "./contracts.ts";

export const stravaSourceSkillManifest = {
  skill_id: "strava",
  label: "Strava running history",
  description:
    "Review runs from a Strava account-export ZIP (up to 48 MiB), including available mile splits, or import activities.csv summaries.",
  source_kind: "file",
  connector_version: "origin-upload@1.0.0",
  parser: { name: STRAVA_PARSER_NAME, version: STRAVA_PARSER_VERSION },
  limits: STRAVA_LIMITS,
  input_fields: [
    {
      name: "file",
      label: "Strava export ZIP or activities.csv",
      target: "source",
      control: "file",
      required: true,
      secret: false,
      accept: [".zip", ".csv", "application/zip", "text/csv"],
    },
  ],
  review_actions: ["review_import"],
} as const satisfies SourceSkillManifest;
