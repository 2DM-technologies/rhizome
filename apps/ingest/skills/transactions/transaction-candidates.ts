import {
  candidateBundle,
  type CandidateBundle,
  type SourceJsonObject,
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
      const sourceProperties = sourceJsonObject({
        amount: transaction.amount,
        currency: transaction.currency,
        ...(transaction.postedAt ? { posted_at: transaction.postedAt } : {}),
        ...(transaction.rawDescription
          ? { raw_description: transaction.rawDescription.slice(0, 1_024) }
          : {}),
        ...transaction.sourceProperties,
      });
      const keys = {
        ...transaction.keys,
        ...(transaction.fitid ? { fitid: transaction.fitid } : {}),
        account_hash: accountHash,
      };
      const identityProperties = sourceJsonObject(
        options.identitySourceProperties?.(sourceProperties) ?? sourceProperties,
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

function sourceJsonObject(value: Readonly<Record<string, unknown>>): SourceJsonObject {
  const converted = sourceJsonValue(value, new Set(), "Transaction source properties");
  if (!converted || typeof converted !== "object" || Array.isArray(converted)) {
    throw new Error("Transaction source properties must be a JSON object");
  }
  return converted as SourceJsonObject;
}

function sourceJsonValue(value: unknown, ancestors: Set<object>, label: string): SourceJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object") throw new Error(`${label} is not JSON-safe`);
  if (ancestors.has(value)) throw new Error(`${label} contains a cycle`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => sourceJsonValue(entry, ancestors, label));
    }
    const result: SourceJsonObject = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) throw new Error(`${label}.${key} is undefined`);
      result[key] = sourceJsonValue(entry, ancestors, `${label}.${key}`);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

async function sha256(value: string): Promise<`sha256:${string}`> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return `sha256:${hex}`;
}
