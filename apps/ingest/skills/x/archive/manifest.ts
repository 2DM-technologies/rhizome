import type { SourceSkillManifest } from "../../../../../packages/store-contract/src/source-skills.ts";

import {
  X_ARCHIVE_CONNECTOR_VERSION,
  X_ARCHIVE_SKILL_ID,
  X_POST_PARSER_NAME,
  X_POST_PARSER_VERSION,
  X_SOURCE_LIMITS,
} from "../definition.ts";

export const xArchiveSourceSkillManifest = {
  skill_id: X_ARCHIVE_SKILL_ID,
  label: "X archive",
  description:
    "Import up to 100 most recent eligible posts from a selectively processed X archive.",
  source_kind: "file",
  connector_version: X_ARCHIVE_CONNECTOR_VERSION,
  parser: { name: X_POST_PARSER_NAME, version: X_POST_PARSER_VERSION },
  limits: X_SOURCE_LIMITS,
  file_capture: {
    kind: "file_capture_preprocessor@1",
    implementation: "x_archive_selection",
    version: "x-archive-selection-worker@1",
  },
  input_fields: [
    {
      name: "file",
      label: "X archive ZIP",
      target: "source",
      control: "file",
      required: true,
      secret: false,
      accept: ["application/zip", ".zip"],
      help_text: "Up to 100 most recent eligible posts are selected in your browser before upload.",
      help_url: "https://help.x.com/en/managing-your-account/accessing-your-x-data",
    },
  ],
  review_actions: ["review_import"],
} as const satisfies SourceSkillManifest;
