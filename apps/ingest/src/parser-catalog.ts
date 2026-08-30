import type { TransactionParser } from "../transactions/types.ts";
import { installedCredentialedSourceSkillDefinitions } from "./credentialed-source-catalog.ts";
import { installedFileSourceSkills } from "./source-skill-catalog.ts";

// This registration list can become generated when committed skills move out of the application
// tree; callers depend only on the typed lookup below.
const registeredTransactionParsers: readonly TransactionParser[] = [
  ...installedFileSourceSkills.all().map((skill) => skill.parser),
  ...installedCredentialedSourceSkillDefinitions.map((definition) => definition.parser),
];

/** Name lookup fails closed if two installed skills claim different implementations. */
export class TransactionParserCatalog {
  readonly #byName: ReadonlyMap<string, TransactionParser>;

  constructor(parsers: readonly TransactionParser[]) {
    const byName = new Map<string, TransactionParser>();
    for (const parser of parsers) {
      if (!parser.name || !parser.version) {
        throw new Error("Transaction parsers must declare a name and version");
      }
      const existing = byName.get(parser.name);
      if (existing && existing !== parser) {
        throw new Error(`Conflicting transaction parser registration: ${parser.name}`);
      }
      byName.set(parser.name, parser);
    }
    this.#byName = byName;
  }

  forName(name: string): TransactionParser | undefined {
    return this.#byName.get(name);
  }
}

const transactionParsers = new TransactionParserCatalog(registeredTransactionParsers);

export function transactionParserFor(name: string): TransactionParser | undefined {
  return transactionParsers.forName(name);
}
