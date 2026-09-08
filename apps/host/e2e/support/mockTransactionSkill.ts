import type { MediaObject } from "@rnet/types";
import type { SourceSkillManifest } from "@rhizome/store-contract";

import type {
  ParsedTransactions,
  TransactionParser,
} from "../../../ingest/skills/transactions/contracts.ts";
import {
  verifyTransactions,
  type VerifyTransactionsOptions,
} from "../../../ingest/skills/transactions/verify.ts";
import {
  OWNER_ID,
  type MockOriginUpload,
  type MockSourceSkillAdapter,
  type MockStagedImport,
} from "./mockStore.ts";

export interface MockTransactionStageOptions {
  readonly actionResumed?: boolean;
  readonly idNamespace: string;
  readonly manifest: SourceSkillManifest;
  readonly normalize?: (parsed: ParsedTransactions) => ParsedTransactions;
  readonly origin: MockOriginUpload;
  readonly parser: TransactionParser;
  readonly verifyOptions?: VerifyTransactionsOptions;
}

export async function stageMockTransactions({
  idNamespace,
  manifest,
  normalize = (parsed) => parsed,
  origin,
  parser,
  verifyOptions,
}: MockTransactionStageOptions): Promise<MockStagedImport> {
  const parsed = normalize(await parser.parse(origin.payload));
  const candidates = parsed.transactions.map((transaction, index): MediaObject => ({
    rnet_schema: "0.1",
    uri: `rnet://object/${indexedUuid(idNamespace, index)}`,
    owner: `rnet://id/${OWNER_ID}`,
    type: "transaction",
    elements: [],
    keys: transaction.keys ?? (transaction.fitid ? { fitid: transaction.fitid } : {}),
    source: {
      ingest: {
        method: "parser",
        reproducible: true,
        skill: `${manifest.parser.name}@0.0.0-test`,
      },
      origins: [origin.document.uri],
      properties: {
        ...(transaction.sourceProperties ?? {}),
        amount: transaction.amount,
        currency: transaction.currency,
        ...(transaction.postedAt ? { posted_at: transaction.postedAt } : {}),
        ...(transaction.rawDescription ? { raw_description: transaction.rawDescription } : {}),
      },
    },
  }));
  return {
    candidates,
    verification: { ...verifyTransactions(parsed, verifyOptions) },
  };
}

export function createTransactionFileMockAdapter({
  contentHash,
  manifest,
  operationId,
  originId,
  parser,
  sourceId,
}: {
  contentHash: string;
  manifest: SourceSkillManifest;
  operationId: string;
  originId: string;
  parser: TransactionParser;
  sourceId: string;
}): MockSourceSkillAdapter {
  const accepted = new Set(
    manifest.input_fields.flatMap((field) =>
      field.control === "file" ? (field.accept ?? []) : [],
    ),
  );
  return {
    manifest,
    operationId,
    originUpload: {
      contentHash,
      id: originId,
      accepts({ label, mime }) {
        const extension = `.${label.toLocaleLowerCase().split(".").at(-1)}`;
        return accepted.has(extension) || accepted.has(mime);
      },
    },
    sourceId,
    stage: ({ origin }) =>
      stageMockTransactions({
        idNamespace: operationId,
        manifest,
        origin,
        parser,
      }),
  };
}

function indexedUuid(namespace: string, index: number): string {
  const prefix = namespace.slice(0, -12);
  return `${prefix}${String(index + 1).padStart(12, "0")}`;
}
