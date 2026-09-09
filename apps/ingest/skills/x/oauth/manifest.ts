import type { SourceSkillManifest } from "../../../../../packages/store-contract/src/source-skills.ts";

import {
  X_OAUTH_CONNECTOR_VERSION,
  X_OAUTH_SKILL_ID,
  X_POST_PARSER_NAME,
  X_POST_PARSER_VERSION,
  X_SOURCE_LIMITS,
} from "../definition.ts";

/**
 * Provider-owned manifest data. The generic OAuth mode exposes only the sign-in affordance; the
 * adapter's explicit PKCE policy remains a server-to-skill concern.
 */
export const xOAuthSourceManifest = {
  skill_id: X_OAUTH_SKILL_ID,
  label: "X account",
  description: "Connect an X account and import up to 100 most recent eligible posts.",
  source_kind: "credentialed_remote",
  connector_version: X_OAUTH_CONNECTOR_VERSION,
  parser: { name: X_POST_PARSER_NAME, version: X_POST_PARSER_VERSION },
  limits: X_SOURCE_LIMITS,
  connection: { mode: "oauth2", button_label: "Sign in with X" },
  input_fields: [],
  review_actions: ["review_import", "refresh_source"],
} as const satisfies SourceSkillManifest;
