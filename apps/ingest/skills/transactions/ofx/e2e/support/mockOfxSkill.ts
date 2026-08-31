import { createTransactionFileMockAdapter } from "../../../../../../host/e2e/support/mockTransactionSkill.ts";
import { ofxSourceSkillManifest } from "../../manifest.ts";
import { ofxParser } from "../../parser.ts";

export const OFX_ORIGIN_ID = "0198f2a1-0102-7a02-8a02-000000000002";
export const OFX_IMPORT_SOURCE_ID = "0198f2a1-0202-7b02-8b02-000000000002";
export const OFX_IMPORT_OPERATION_ID = "0198f2a1-0302-7c02-8c02-000000000002";

export const mockOfxSourceSkill = createTransactionFileMockAdapter({
  contentHash: `sha256:${"b".repeat(64)}`,
  manifest: ofxSourceSkillManifest,
  operationId: OFX_IMPORT_OPERATION_ID,
  originId: OFX_ORIGIN_ID,
  parser: ofxParser,
  sourceId: OFX_IMPORT_SOURCE_ID,
});
