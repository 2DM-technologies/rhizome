import {
  candidateBundle,
  sourceJsonObject,
  type CandidateBundle,
  type SourceJsonValue,
} from "../../source-skills/candidate-bundle.ts";

import type { ParsedTransactions } from "./contracts.ts";
import { verifyTransactions, type VerifyTransactionsOptions } from "./verify.ts";

export interface CompileTransactionCandidatesOptions {
  readonly verify?: VerifyTransactionsOptions;
  readonly identitySourceProperties?: (
    properties: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, unknown>>;
}

/** Compiles the canonical transaction IR through shared VERIFY to candidate_bundle@1. */
export async function compileTransactionCandidates(
  parsed: ParsedTransactions,
  options: CompileTransactionCandidatesOptions = {},
): Promise<CandidateBundle> {
  const verify = verifyTransactions(parsed, options.verify);
  const candidates = await Promise.all(
    parsed.transactions.map(async (transaction) => {
      const accountHash = await sha256(transaction.accountIdentity ?? "default");
      const sourceProperties = sourceJsonObject(
        {
          amount: transaction.amount,
          currency: transaction.currency,
          ...(transaction.postedAt ? { posted_at: transaction.postedAt } : {}),
          ...(transaction.rawDescription
            ? { raw_description: transaction.rawDescription.slice(0, 1_024) }
            : {}),
          ...transaction.sourceProperties,
        },
        "Transaction source properties",
      );
      const keys = {
        ...transaction.keys,
        ...(transaction.fitid ? { fitid: transaction.fitid } : {}),
        account_hash: accountHash,
      };
      const identityProperties = sourceJsonObject(
        options.identitySourceProperties?.(sourceProperties) ?? sourceProperties,
        "Transaction identity source properties",
      );
      const semanticIdentity: SourceJsonValue = transaction.fitid
        ? { type: "transaction", account_hash: accountHash, fitid: transaction.fitid }
        : { type: "transaction", account_hash: accountHash, properties: sourceProperties };
      return {
        type: "transaction",
        keys,
        sourceProperties,
        semanticIdentity,
        semanticSourceProperties: identityProperties,
        elements: [],
      };
    }),
  );
  return candidateBundle(candidates, verify);
}

async function sha256(value: string): Promise<`sha256:${string}`> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return `sha256:${hex}`;
}
