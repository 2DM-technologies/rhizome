/**
 * Normalized transaction intermediate representation shared by committed parsers, VERIFY, and the
 * ingestion runtime. Provider-specific capture types stay with their owning skill.
 */
export interface ParsedTransaction {
  amount: string;
  currency: string;
  postedAt?: string;
  postedAtEpoch?: number;
  pending?: boolean;
  rawDescription?: string;
  fitid?: string;
  accountIdentity?: string;
  keys?: Record<string, string>;
  sourceProperties?: Record<string, unknown>;
}

/** Connected-source balance snapshot used to reconcile consecutive provider responses. */
export interface ParsedAccountBalance {
  accountIdentity: string;
  currency: string;
  balance: string;
  balanceAt: string;
  balanceAtEpoch: number;
  sourceRecordCount: number;
}

export interface ParsedProviderIssue {
  code: string;
  scope: "general" | "connection" | "account" | "unknown";
  hasConnectionReference: boolean;
  hasAccountReference: boolean;
}

export interface ParsedProviderErrors {
  structured: ParsedProviderIssue[];
  legacyCount: number;
}

/**
 * Statement-level evidence carried alongside parsed transactions. OFX supplies a closing ledger
 * balance but no independent opening balance, so VERIFY reports the implied opening balance rather
 * than pretending that the transaction total should equal the closing balance.
 */
export interface ParsedStatementBalance {
  accountIdentity: string;
  currency: string;
  ledgerBalance: string;
  balanceAsOf: string;
  periodStart: string;
  periodEnd: string;
  sourceRecordCount: number;
}

export interface ParsedTransactions {
  transactions: ParsedTransaction[];
  sourceRecordCount: number;
  /** Connected responses may validly contain accounts but no new transactions. */
  allowEmpty?: boolean;
  accountBalances?: ParsedAccountBalance[];
  providerErrors?: ParsedProviderErrors;
  statementBalances?: ParsedStatementBalance[];
}

export interface TransactionParser {
  readonly name: string;
  readonly version: string;
  parse(bytes: Uint8Array): Promise<ParsedTransactions>;
}
