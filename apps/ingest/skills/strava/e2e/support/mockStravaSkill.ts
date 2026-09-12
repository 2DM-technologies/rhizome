import type { MediaObject } from "@rnet/types";
import { OWNER_ID, type MockSourceSkillAdapter } from "@rhizome/test-support/mockStore";
import { stravaSourceSkill } from "../../source.ts";

const manifest = stravaSourceSkill.manifest;
export const mockStravaSkill: MockSourceSkillAdapter = {
  manifest,
  operationId: "0198f2a1-8101-7101-8101-000000000001",
  sourceId: "0198f2a1-8102-7102-8102-000000000001",
  originUpload: {
    id: "0198f2a1-8103-7103-8103-000000000001",
    contentHash: `sha256:${"a".repeat(64)}`,
    accepts: ({ label }) => /\.(zip|csv)$/i.test(label),
  },
  async stage({ origin }) {
    const bundle = await stravaSourceSkill.compiledSource.compile({
      bytes: origin.payload,
      limits: manifest.limits,
    });
    const candidates = bundle.candidates.map((draft, index): MediaObject => ({
      rnet_schema: "0.1",
      uri: `rnet://object/0198f2a1-8104-7104-8104-${String(index + 1).padStart(12, "0")}`,
      owner: `rnet://id/${OWNER_ID}`,
      type: draft.type,
      keys: { ...draft.keys },
      elements: [],
      source: {
        ingest: { method: "parser", reproducible: true, skill: manifest.parser.version },
        origins: [origin.document.uri],
        properties: draft.sourceProperties,
      },
    }));
    return {
      candidates,
      verification: {
        ...bundle.verify,
        checks: [...bundle.verify.checks],
        source_record_count: Reflect.get(bundle.verify, "source_record_count") as number,
        candidate_count: Reflect.get(bundle.verify, "candidate_count") as number,
      },
    };
  },
};
