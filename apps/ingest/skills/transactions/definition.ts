import type { SourceSkillManifest } from "../../../../packages/store-contract/src/source-skills.ts";

import type { FileSourceSkill } from "../../file-sources/types.ts";
import {
  CANDIDATE_BUNDLE_CAPABILITY,
  type SourceParser,
} from "../../source-skills/candidate-bundle.ts";
import type { ParsedTransactions } from "./contracts.ts";
import { compileTransactionCandidates } from "./transaction-candidates.ts";

/** Keeps each transaction format independently registered while sharing the family compiler. */
export function defineTransactionFileSource(
  manifest: SourceSkillManifest & { readonly source_kind: "file" },
  parser: SourceParser<ParsedTransactions>,
): FileSourceSkill {
  return {
    manifest,
    parser,
    compiledSource: {
      kind: CANDIDATE_BUNDLE_CAPABILITY,
      async compile({ bytes }) {
        return compileTransactionCandidates(await parser.parse(bytes));
      },
    },
  };
}
