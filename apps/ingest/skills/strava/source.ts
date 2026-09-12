import type { FileSourceSkill } from "../../file-sources/types.ts";
import {
  CANDIDATE_BUNDLE_CAPABILITY,
  candidateBundle,
  sourceJsonObject,
} from "../../source-skills/candidate-bundle.ts";
import {
  assertCaptureLimit,
  assertCandidateBundleLimits,
} from "../../source-skills/execution-limits.ts";
import { stravaSourceSkillManifest } from "./manifest.ts";
import { stravaParser } from "./parser.ts";
import { verifyStrava } from "./verify.ts";

export const stravaSourceSkill: FileSourceSkill = {
  manifest: stravaSourceSkillManifest,
  parser: stravaParser,
  compiledSource: {
    kind: CANDIDATE_BUNDLE_CAPABILITY,
    async compile({ bytes, limits }) {
      assertCaptureLimit(bytes.byteLength, limits);
      const parsed = await stravaParser.parse(bytes);
      const bundle = candidateBundle(
        parsed.activities.map((activity) => ({
          type: "fitness_activity",
          keys: { strava_activity_id: activity.id },
          sourceProperties: sourceJsonObject(activity.properties, "Strava activity properties"),
          semanticIdentity: { type: "fitness_activity", strava_activity_id: activity.id },
          elements: [],
        })),
        verifyStrava(parsed),
      );
      assertCandidateBundleLimits(bundle, limits);
      return { ...bundle, destination: { title: "Running history" } };
    },
  },
};
