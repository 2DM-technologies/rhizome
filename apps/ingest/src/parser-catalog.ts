import { csvParser } from "../skills/csv/scripts/parse-csv.ts";
import { ofxParser } from "../skills/ofx/scripts/parse-ofx.ts";
import { simpleFinParser } from "../skills/simplefin/scripts/parse-simplefin.ts";
import type { TransactionParser } from "../transactions/types.ts";

// This registration list can become generated when committed skills move out of the application
// tree; callers depend only on the typed lookup below.
const registeredTransactionParsers: readonly TransactionParser[] = [
  csvParser,
  ofxParser,
  simpleFinParser,
];

const transactionParsers = new Map<string, TransactionParser>(
  registeredTransactionParsers.map((parser) => [parser.name, parser] as const),
);

export function transactionParserFor(name: string): TransactionParser | undefined {
  return transactionParsers.get(name);
}
