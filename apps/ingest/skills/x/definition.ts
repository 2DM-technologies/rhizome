import type { SourceExecutionLimits } from "../../../../packages/store-contract/src/source-skills.ts";

import {
  CANDIDATE_BUNDLE_CAPABILITY,
  type CandidateBundleCapability,
} from "../../source-skills/candidate-bundle.ts";
import type { SelectedXPosts } from "./contracts.ts";
import { compileXPostCandidates } from "./tweet-candidates.ts";

export const X_ARCHIVE_SKILL_ID = "x_archive" as const;
export const X_OAUTH_SKILL_ID = "x_oauth" as const;

export const X_ARCHIVE_CONNECTOR_VERSION = "x-archive-selection@1" as const;
export const X_OAUTH_CONNECTOR_VERSION = "x-oauth@1" as const;
export const X_POST_PARSER_NAME = "x-posts" as const;
export const X_POST_PARSER_VERSION = "x-posts@1" as const;

export const X_SOURCE_LIMITS = Object.freeze({
  maxCandidates: 100,
  maxCaptureBytes: 48 * 1_024 * 1_024,
  maxElementBytes: 25 * 1_024 * 1_024,
  maxTotalElementBytes: 40 * 1_024 * 1_024,
}) satisfies SourceExecutionLimits;

/** Archive and OAuth adapters normalize independently, then share this exact compiler boundary. */
export function defineXCandidateBundle<Input extends { readonly limits: SourceExecutionLimits }>(
  normalize: (input: Input) => SelectedXPosts | Promise<SelectedXPosts>,
): CandidateBundleCapability<Input> {
  return {
    kind: CANDIDATE_BUNDLE_CAPABILITY,
    async compile(input) {
      return compileXPostCandidates(await normalize(input), input.limits);
    },
  };
}
