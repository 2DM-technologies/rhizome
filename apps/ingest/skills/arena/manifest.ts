import type { SourceSkillManifest } from "../../../../packages/store-contract/src/source-skills.ts";
import { CONTENT_IMPORT_PUSH_PIPELINE } from "../../source-skills/import-push-pipelines.ts";

import { ARENA_CONNECTOR_VERSION, ARENA_PARSER_NAME, ARENA_SKILL_ID } from "./contracts.ts";
import { ARENA_PARSER_VERSION } from "./scripts/parse-arena.ts";

export const arenaSourceSkillManifest = {
  skill_id: ARENA_SKILL_ID,
  label: "Are.na channel",
  description: "Import the ordered blocks and original media from a public Are.na channel.",
  source_kind: "public_remote",
  connector_version: ARENA_CONNECTOR_VERSION,
  parser: { name: ARENA_PARSER_NAME, version: ARENA_PARSER_VERSION },
  limits: {
    maxCandidates: 200,
    // The source client counts decoded response bytes; the persisted JSON capture base64-encodes
    // media, so its generic capture envelope needs the corresponding expansion headroom.
    maxCaptureBytes: 640 * 1_024 * 1_024, // 640 MiB
    maxElementBytes: 160 * 1_024 * 1_024, // 160 MiB
    maxTotalElementBytes: 400 * 1_024 * 1_024, // 400 MiB
  },
  input_fields: [
    {
      name: "url",
      label: "Public Are.na channel URL",
      target: "source",
      control: "url",
      required: true,
      secret: false,
      placeholder: "https://www.are.na/owner/channel-slug",
      help_text: "The URL locates a channel; the skill reads it through Are.na's public API.",
      help_url: "https://www.are.na/",
    },
  ],
  review_actions: ["review_import", "refresh_source"],
  import_push_pipeline: CONTENT_IMPORT_PUSH_PIPELINE,
} as const satisfies SourceSkillManifest;
