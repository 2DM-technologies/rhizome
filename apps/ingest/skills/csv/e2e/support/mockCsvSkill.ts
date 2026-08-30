import { createTransactionFileMockAdapter } from "../../../../../host/e2e/support/mockTransactionSkill.ts";
import { csvSourceSkillManifest } from "../../manifest.ts";
import { csvParser } from "../../scripts/parse-csv.ts";

export const CSV_ORIGIN_ID = "0198f2a1-0101-7a01-8a01-000000000001";
export const CSV_IMPORT_SOURCE_ID = "0198f2a1-0201-7b01-8b01-000000000001";
export const CSV_IMPORT_OPERATION_ID = "0198f2a1-0301-7c01-8c01-000000000001";

export const mockCsvSourceSkill = createTransactionFileMockAdapter({
  contentHash: `sha256:${"a".repeat(64)}`,
  manifest: csvSourceSkillManifest,
  operationId: CSV_IMPORT_OPERATION_ID,
  originId: CSV_ORIGIN_ID,
  parser: csvParser,
  sourceId: CSV_IMPORT_SOURCE_ID,
});
