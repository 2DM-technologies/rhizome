import type { FileSourceSkill } from "../../../ingest/file-sources/types.ts";
import {
  candidateBundle,
  CANDIDATE_BUNDLE_CAPABILITY,
  type SourceCandidateDraft,
} from "../../../ingest/source-skills/candidate-bundle.ts";
import { PNG } from "./push-images.ts";

export const gardenImportCandidate: SourceCandidateDraft = {
  type: "garden.plant",
  keys: { external_id: "fern" },
  sourceProperties: { title: "Fern" },
  elements: [
    {
      role: "content",
      kind: "image",
      mime: "image/png",
      bytes: PNG,
      byteSize: PNG.byteLength,
      contentHash: `sha256:${new Bun.CryptoHasher("sha256").update(PNG).digest("hex")}`,
    },
  ],
  semanticIdentity: "fern",
};

export const transactionImportCandidate: SourceCandidateDraft = {
  type: "transaction",
  keys: { fitid: "synthetic-transaction" },
  sourceProperties: { amount: "-12.34", currency: "USD", raw_description: "Synthetic purchase" },
  elements: [],
  semanticIdentity: "synthetic-transaction",
};

export function importPushSource(
  candidates: readonly SourceCandidateDraft[] = [gardenImportCandidate],
  verifyOk = true,
): FileSourceSkill {
  const parser = {
    name: "push-import-fixture",
    version: "push-import-fixture@1.0.0",
    async parse(bytes: Uint8Array) {
      if (new TextDecoder().decode(bytes) !== "push-import-fixture")
        throw new Error("Wrong capture");
      return candidates;
    },
  };
  return {
    manifest: {
      skill_id: "push-import-fixture",
      label: "Push import fixture",
      description: "Exercises push after a reviewed import commits.",
      source_kind: "file",
      connector_version: "origin-upload@1.0.0",
      parser: { name: parser.name, version: parser.version },
      limits: {
        maxCandidates: 10,
        maxCaptureBytes: 1024,
        maxElementBytes: 1024,
        maxTotalElementBytes: 10_240,
      },
      input_fields: [
        {
          name: "file",
          label: "Fixture",
          target: "source",
          control: "file",
          required: true,
          secret: false,
        },
      ],
      review_actions: ["review_import"],
    },
    parser,
    compiledSource: {
      kind: CANDIDATE_BUNDLE_CAPABILITY,
      async compile({ bytes }) {
        return candidateBundle(await parser.parse(bytes), {
          ok: verifyOk,
          checks: [{ name: "fixture", ok: verifyOk, detail: "Synthetic import verification" }],
        });
      },
    },
  };
}
