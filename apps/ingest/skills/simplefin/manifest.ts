import type { SourceSkillManifest } from "../../../../packages/store-contract/src/source-skills.ts";

import {
  SIMPLEFIN_CONNECTOR_VERSION,
  SIMPLEFIN_PARSER_NAME,
  SIMPLEFIN_PARSER_VERSION,
  SIMPLEFIN_SKILL_ID,
} from "./contracts.ts";

export const simpleFinSourceSkillManifest = {
  skill_id: SIMPLEFIN_SKILL_ID,
  label: "SimpleFIN",
  description:
    "Connect financial accounts with a one-time SimpleFIN Bridge setup token, then review transactions before importing them.",
  source_kind: "credentialed_remote",
  connector_version: SIMPLEFIN_CONNECTOR_VERSION,
  parser: { name: SIMPLEFIN_PARSER_NAME, version: SIMPLEFIN_PARSER_VERSION },
  connection: {
    claim_policy: { kind: "single_use_global", attempts: 10, window_hours: 1 },
  },
  input_fields: [
    {
      name: "setup_token",
      label: "SimpleFIN setup token",
      target: "connection",
      control: "text",
      required: true,
      secret: true,
      placeholder: "Paste setup token",
      help_text: "Create a one-time token in SimpleFIN Bridge.",
      help_url: "https://bridge.simplefin.org/simplefin/create",
    },
  ],
  review_actions: ["review_import", "refresh_source"],
} as const satisfies SourceSkillManifest;
