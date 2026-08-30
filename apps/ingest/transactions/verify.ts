import type {
  ParsedAccountBalance,
  ParsedProviderErrors,
  ParsedStatementBalance,
  ParsedTransaction,
  ParsedTransactions,
} from "./types.ts";

export interface VerifyCheck {
  name:
    | "non_empty"
    | "object_count"
    | "required_fields"
    | "unique_transaction_ids"
    | "amount_totals"
    | "balance_reconciliation"
    | "provider_errors"
    | "account_balances"
    | "balance_delta"
    | "history_recovery";
  ok: boolean;
  detail: string;
}

export interface BalanceReconciliation {
  account_index: number;
  currency: string;
  period_start: string;
  period_end: string;
  balance_as_of: string;
  source_record_count: number;
  candidate_count: number;
  transaction_total: string;
  ledger_balance: string;
  implied_opening_balance: string;
}

export interface AccountBalanceSnapshot {
  account_index: number;
  currency: string;
  balance: string;
  balance_at: string;
  source_record_count: number;
  candidate_count: number;
}

export interface BalanceDeltaReconciliation {
  account_index: number;
  currency: string;
  previous_balance: string;
  current_balance: string;
  balance_delta: string;
  transaction_total: string;
  previous_balance_at: string;
  current_balance_at: string;
}

/**
 * A newly discovered account has no previous balance to reconcile. Record only its stable position
 * in the current response so VERIFY can acknowledge the baseline without exposing provider IDs.
 */
export interface BalanceDeltaBaseline {
  account_index: number;
}

export interface ProviderErrorEvidence {
  structured_count: number;
  legacy_count: number;
  connection_reference_count: number;
  account_reference_count: number;
  codes: string[];
  scopes: Array<"general" | "connection" | "account" | "unknown">;
}

/** Owner-reviewed evidence that a connected source intentionally started a new balance baseline. */
export interface HistoryRecoveryEvidence {
  mode: "rebaseline";
  reason: "simplefin_history_gap" | "unreconciled_backdated_activity";
  previous_balance_at: string;
  history_resumes_at: string;
}

export interface VerifyReport {
  ok: boolean;
  source_record_count: number;
  candidate_count: number;
  totals_by_currency: Record<string, string>;
  balance_reconciliations: BalanceReconciliation[];
  account_balance_snapshots: AccountBalanceSnapshot[];
  balance_delta_reconciliations: BalanceDeltaReconciliation[];
  balance_delta_baselines: BalanceDeltaBaseline[];
  provider_error_evidence?: ProviderErrorEvidence;
  history_recovery?: HistoryRecoveryEvidence;
  checks: VerifyCheck[];
}

export interface VerifyTransactionsOptions {
  previous?: ParsedTransactions;
  historyRecovery?: HistoryRecoveryEvidence;
  /** Inclusive start of the current connected response, used to detect removed overlap records. */
  historyStartEpoch?: number;
}

interface ExactDecimal {
  coefficient: bigint;
  scale: number;
}

const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const CURRENCY = /^[A-Z]{3}$/;

export function verifyTransactions(
  parsed: ParsedTransactions,
  options: VerifyTransactionsOptions = {},
): VerifyReport {
  const identifiers = new Set<string>();
  let identifiersUnique = true;
  let requiredFields = true;
  const totals = new Map<string, ExactDecimal>();
  const accountTotals = new Map<string, ExactDecimal>();
  const accountCounts = new Map<string, number>();

  for (const transaction of parsed.transactions) {
    const amount = exactDecimal(transaction.amount);
    const currencyValid = CURRENCY.test(transaction.currency);
    const postedAtValid = validPostingEvidence(transaction);
    const fitidValid = Boolean(transaction.fitid?.trim());
    const accountValid = Boolean(transaction.accountIdentity?.trim());
    requiredFields &&=
      Boolean(amount) && currencyValid && postedAtValid && fitidValid && accountValid;

    if (fitidValid && accountValid) {
      const identifier = identityKey(transaction.accountIdentity!, transaction.fitid!);
      if (identifiers.has(identifier)) identifiersUnique = false;
      identifiers.add(identifier);
    } else identifiersUnique = false;

    if (!amount || !currencyValid) continue;
    totals.set(transaction.currency, add(totals.get(transaction.currency), amount));
    if (accountValid) {
      const key = accountKey(transaction.accountIdentity!, transaction.currency);
      accountTotals.set(key, add(accountTotals.get(key), amount));
      accountCounts.set(key, (accountCounts.get(key) ?? 0) + 1);
    }
  }

  const nonEmpty = parsed.transactions.length > 0;
  const connectedEmptyAllowed =
    parsed.allowEmpty === true && Boolean(parsed.accountBalances?.length) && !nonEmpty;
  const recordSetAccepted = nonEmpty || connectedEmptyAllowed;
  const countMatches =
    Number.isSafeInteger(parsed.sourceRecordCount) &&
    parsed.sourceRecordCount >= 0 &&
    parsed.transactions.length === parsed.sourceRecordCount;
  const totalsByCurrency = Object.fromEntries(
    [...totals]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, total]) => [currency, formatDecimal(total)]),
  );
  const balance = verifyStatementBalances(parsed.statementBalances, accountTotals, accountCounts);
  const accounts = verifyAccountBalances(
    parsed.accountBalances,
    accountTotals,
    accountCounts,
    parsed.sourceRecordCount,
  );
  const delta: {
    check?: VerifyCheck;
    reconciliations: BalanceDeltaReconciliation[];
    baselines: BalanceDeltaBaseline[];
  } = options.previous
    ? verifyBalanceDelta(parsed, options.previous, options.historyStartEpoch)
    : {
        reconciliations: [],
        baselines: options.historyRecovery
          ? (parsed.accountBalances ?? []).map((_, index) => ({ account_index: index + 1 }))
          : [],
      };
  const provider = verifyProviderErrors(parsed.providerErrors);
  const checks: VerifyCheck[] = [
    {
      name: "non_empty",
      ok: recordSetAccepted,
      detail: nonEmpty
        ? `${parsed.transactions.length} transactions parsed`
        : connectedEmptyAllowed
          ? "Connected response contains accounts and no new transactions"
          : "No transactions parsed",
    },
    {
      name: "object_count",
      ok: countMatches,
      detail: `${parsed.transactions.length} candidates from ${parsed.sourceRecordCount} source records`,
    },
    {
      name: "required_fields",
      ok: requiredFields,
      detail: requiredFields
        ? "Every transaction has a valid amount, ISO currency, posting evidence, transaction ID, and account ID"
        : "A transaction has invalid or missing required data",
    },
    {
      name: "unique_transaction_ids",
      ok: identifiersUnique,
      detail: identifiersUnique
        ? "Transaction IDs are unique per account"
        : "Duplicate or missing transaction/account ID",
    },
    {
      name: "amount_totals",
      ok: requiredFields && recordSetAccepted,
      detail:
        Object.entries(totalsByCurrency)
          .map(([currency, total]) => `${currency} ${total}`)
          .join(", ") ||
        (connectedEmptyAllowed
          ? "No transaction amounts in this connected response"
          : "No valid monetary amounts"),
    },
    ...(balance.check ? [balance.check] : []),
    ...(accounts.check ? [accounts.check] : []),
    ...(delta.check ? [delta.check] : []),
    ...(provider.check ? [provider.check] : []),
    ...(options.historyRecovery
      ? [
          {
            name: "history_recovery" as const,
            ok: true,
            detail: `Owner-reviewed rebaseline resumes connected history at ${options.historyRecovery.history_resumes_at} after the previous balance at ${options.historyRecovery.previous_balance_at}`,
          },
        ]
      : []),
  ];
  return {
    ok: checks.every((check) => check.ok),
    source_record_count: parsed.sourceRecordCount,
    candidate_count: parsed.transactions.length,
    totals_by_currency: totalsByCurrency,
    balance_reconciliations: balance.reconciliations,
    account_balance_snapshots: accounts.snapshots,
    balance_delta_reconciliations: delta.reconciliations,
    balance_delta_baselines: delta.baselines,
    ...(provider.evidence ? { provider_error_evidence: provider.evidence } : {}),
    ...(options.historyRecovery ? { history_recovery: options.historyRecovery } : {}),
    checks,
  };
}

function verifyStatementBalances(
  balances: ParsedStatementBalance[] | undefined,
  accountTotals: Map<string, ExactDecimal>,
  accountCounts: Map<string, number>,
): { check?: VerifyCheck; reconciliations: BalanceReconciliation[] } {
  if (balances === undefined) return { reconciliations: [] };

  let valid = balances.length > 0;
  const evidenceKeys = new Set<string>();
  const reconciliations: BalanceReconciliation[] = [];
  for (const evidence of balances) {
    const key = accountKey(evidence.accountIdentity, evidence.currency);
    const ledger = exactDecimal(evidence.ledgerBalance);
    const transactionTotal = accountTotals.get(key);
    const candidateCount = accountCounts.get(key) ?? 0;
    const evidenceValid =
      Boolean(evidence.accountIdentity.trim()) &&
      CURRENCY.test(evidence.currency) &&
      Boolean(ledger) &&
      isIsoDate(evidence.periodStart) &&
      isIsoDate(evidence.periodEnd) &&
      isIsoDate(evidence.balanceAsOf) &&
      evidence.periodStart <= evidence.periodEnd &&
      evidence.periodStart <= evidence.balanceAsOf &&
      Number.isSafeInteger(evidence.sourceRecordCount) &&
      evidence.sourceRecordCount > 0 &&
      candidateCount === evidence.sourceRecordCount &&
      Boolean(transactionTotal) &&
      !evidenceKeys.has(key);
    valid &&= evidenceValid;
    evidenceKeys.add(key);
    if (!ledger || !transactionTotal) continue;
    reconciliations.push({
      account_index: reconciliations.length + 1,
      currency: evidence.currency,
      period_start: evidence.periodStart,
      period_end: evidence.periodEnd,
      balance_as_of: evidence.balanceAsOf,
      source_record_count: evidence.sourceRecordCount,
      candidate_count: candidateCount,
      transaction_total: formatDecimal(transactionTotal),
      ledger_balance: formatDecimal(ledger),
      implied_opening_balance: formatDecimal(subtract(ledger, transactionTotal)),
    });
  }
  valid &&=
    evidenceKeys.size === accountTotals.size &&
    [...accountTotals.keys()].every((key) => evidenceKeys.has(key));

  return {
    reconciliations,
    check: {
      name: "balance_reconciliation",
      ok: valid,
      detail: valid
        ? reconciliations
            .map(
              (entry) =>
                `${entry.currency} ${entry.ledger_balance} closing - ${entry.currency} ${entry.transaction_total} transactions = ${entry.currency} ${entry.implied_opening_balance} implied opening`,
            )
            .join("; ")
        : "Statement balance evidence is missing or inconsistent with parsed transaction groups",
    },
  };
}

function verifyAccountBalances(
  balances: ParsedAccountBalance[] | undefined,
  accountTotals: Map<string, ExactDecimal>,
  accountCounts: Map<string, number>,
  sourceRecordCount: number,
): { check?: VerifyCheck; snapshots: AccountBalanceSnapshot[] } {
  if (balances === undefined) return { snapshots: [] };

  let valid = balances.length > 0;
  let evidenceRecordCount = 0;
  const evidenceKeys = new Set<string>();
  const snapshots: AccountBalanceSnapshot[] = [];
  for (const evidence of balances) {
    const key = accountKey(evidence.accountIdentity, evidence.currency);
    const balance = exactDecimal(evidence.balance);
    const candidateCount = accountCounts.get(key) ?? 0;
    const evidenceValid =
      Boolean(evidence.accountIdentity.trim()) &&
      CURRENCY.test(evidence.currency) &&
      Boolean(balance) &&
      isIsoTimestamp(evidence.balanceAt) &&
      isValidEpoch(evidence.balanceAtEpoch, false) &&
      epochToIso(evidence.balanceAtEpoch) === evidence.balanceAt &&
      Number.isSafeInteger(evidence.sourceRecordCount) &&
      evidence.sourceRecordCount >= 0 &&
      candidateCount === evidence.sourceRecordCount &&
      !evidenceKeys.has(key);
    valid &&= evidenceValid;
    evidenceRecordCount += evidence.sourceRecordCount;
    evidenceKeys.add(key);
    if (!balance) continue;
    snapshots.push({
      account_index: snapshots.length + 1,
      currency: evidence.currency,
      balance: formatDecimal(balance),
      balance_at: evidence.balanceAt,
      source_record_count: evidence.sourceRecordCount,
      candidate_count: candidateCount,
    });
  }
  valid &&=
    evidenceRecordCount === sourceRecordCount &&
    [...accountTotals.keys()].every((key) => evidenceKeys.has(key));

  return {
    snapshots,
    check: {
      name: "account_balances",
      ok: valid,
      detail: valid
        ? `${snapshots.length} connected account balance snapshots cover ${sourceRecordCount} source transactions`
        : "Connected account balance evidence is missing or inconsistent",
    },
  };
}

function verifyProviderErrors(errors: ParsedProviderErrors | undefined): {
  check?: VerifyCheck;
  evidence?: ProviderErrorEvidence;
} {
  if (errors === undefined) return {};
  const codes = [...new Set(errors.structured.map(({ code }) => code))].sort();
  const scopes = [...new Set(errors.structured.map(({ scope }) => scope))].sort();
  const evidence: ProviderErrorEvidence = {
    structured_count: errors.structured.length,
    legacy_count: errors.legacyCount,
    connection_reference_count: errors.structured.filter(
      ({ hasConnectionReference }) => hasConnectionReference,
    ).length,
    account_reference_count: errors.structured.filter(
      ({ hasAccountReference }) => hasAccountReference,
    ).length,
    codes,
    scopes,
  };
  const ok = evidence.structured_count === 0 && evidence.legacy_count === 0;
  return {
    evidence,
    check: {
      name: "provider_errors",
      ok,
      detail: ok
        ? "The connected source reported no provider errors"
        : `The connected source reported ${evidence.structured_count} structured and ${evidence.legacy_count} legacy provider errors${codes.length ? ` (${codes.join(", ")})` : ""}`,
    },
  };
}

function verifyBalanceDelta(
  current: ParsedTransactions,
  previous: ParsedTransactions,
  historyStartEpoch?: number,
): {
  check: VerifyCheck;
  reconciliations: BalanceDeltaReconciliation[];
  baselines: BalanceDeltaBaseline[];
} {
  const currentBalances = current.accountBalances ?? [];
  const previousBalances = previous.accountBalances ?? [];
  const currentKeys = new Set(
    currentBalances.map((balance) => accountKey(balance.accountIdentity, balance.currency)),
  );
  const previousByAccount = new Map(
    previousBalances.map((balance) => [
      accountKey(balance.accountIdentity, balance.currency),
      balance,
    ]),
  );
  const missingPreviousCount = [...previousByAccount.keys()].filter(
    (key) => !currentKeys.has(key),
  ).length;
  let valid =
    currentBalances.length > 0 &&
    previousBalances.length > 0 &&
    providerErrorsAreEmpty(previous.providerErrors) &&
    currentKeys.size === currentBalances.length &&
    previousByAccount.size === previousBalances.length &&
    missingPreviousCount === 0 &&
    (historyStartEpoch === undefined || isValidEpoch(historyStartEpoch, true));
  const reconciliations: BalanceDeltaReconciliation[] = [];
  const baselines: BalanceDeltaBaseline[] = [];

  for (const [currentIndex, currentBalance] of currentBalances.entries()) {
    const key = accountKey(currentBalance.accountIdentity, currentBalance.currency);
    const previousBalance = previousByAccount.get(key);
    const currentAmount = exactDecimal(currentBalance.balance);
    const previousAmount = previousBalance ? exactDecimal(previousBalance.balance) : undefined;

    if (!previousBalance) {
      if (
        !currentAmount ||
        !isValidEpoch(currentBalance.balanceAtEpoch, false) ||
        epochToIso(currentBalance.balanceAtEpoch) !== currentBalance.balanceAt
      ) {
        valid = false;
        continue;
      }
      baselines.push({ account_index: currentIndex + 1 });
      continue;
    }

    if (
      !currentAmount ||
      !previousAmount ||
      !isValidEpoch(currentBalance.balanceAtEpoch, false) ||
      !isValidEpoch(previousBalance.balanceAtEpoch, false) ||
      previousBalance.balanceAtEpoch > currentBalance.balanceAtEpoch
    ) {
      valid = false;
      continue;
    }

    const currentSettled = settledTransactionsForAccount(current.transactions, currentBalance);
    const previousSettled = settledTransactionsForAccount(previous.transactions, previousBalance);
    valid &&= currentSettled.valid && previousSettled.valid;

    // Compare the value of every current record with the value already represented by the
    // previous balance. This handles first-seen backdated records, amount corrections, pending →
    // posted transitions, and removals/reversals. Prior records are treated as removed only when
    // their posting date falls inside the current response's known overlap.
    const identities = new Set(currentSettled.records.keys());
    if (historyStartEpoch !== undefined) {
      for (const [identity, transaction] of previousSettled.records) {
        if (transaction.postedAtEpoch >= historyStartEpoch) identities.add(identity);
      }
    }
    let transactionTotal: ExactDecimal | undefined;
    for (const identity of identities) {
      const currentTransaction = currentSettled.records.get(identity);
      const previousTransaction = previousSettled.records.get(identity);
      if (currentTransaction && currentTransaction.postedAtEpoch <= currentBalance.balanceAtEpoch) {
        transactionTotal = add(transactionTotal, currentTransaction.amount);
      }
      if (
        previousTransaction &&
        previousTransaction.postedAtEpoch <= previousBalance.balanceAtEpoch
      ) {
        transactionTotal = add(transactionTotal, negate(previousTransaction.amount));
      }
    }
    const balanceDelta = subtract(currentAmount, previousAmount);
    const comparedTotal =
      transactionTotal ?? ({ coefficient: 0n, scale: balanceDelta.scale } satisfies ExactDecimal);
    const matches = decimalsEqual(balanceDelta, comparedTotal);
    valid &&= matches;
    reconciliations.push({
      account_index: currentIndex + 1,
      currency: currentBalance.currency,
      previous_balance: formatDecimal(previousAmount),
      current_balance: formatDecimal(currentAmount),
      balance_delta: formatDecimal(balanceDelta),
      transaction_total: formatDecimal(comparedTotal),
      previous_balance_at: previousBalance.balanceAt,
      current_balance_at: currentBalance.balanceAt,
    });
  }

  const evidenceComplete = reconciliations.length + baselines.length === currentBalances.length;
  const ok = valid && evidenceComplete;

  return {
    reconciliations,
    baselines,
    check: {
      name: "balance_delta",
      ok,
      detail: ok
        ? `${reconciliations.length} connected account balance deltas match non-pending transactions in their balance windows${baselines.length ? `; ${baselines.length} newly discovered account${baselines.length === 1 ? "" : "s"} recorded as baseline evidence` : ""}`
        : missingPreviousCount > 0
          ? `${missingPreviousCount} previously selected account${missingPreviousCount === 1 ? " is" : "s are"} missing from the current response`
          : "A connected account balance delta does not match its non-pending transaction window",
    },
  };
}

function providerErrorsAreEmpty(errors: ParsedProviderErrors | undefined): boolean {
  return !errors || (errors.structured.length === 0 && errors.legacyCount === 0);
}

function settledTransactionsForAccount(
  transactions: ParsedTransaction[],
  balance: ParsedAccountBalance,
): {
  valid: boolean;
  records: Map<string, { amount: ExactDecimal; postedAtEpoch: number }>;
} {
  let valid = true;
  const records = new Map<string, { amount: ExactDecimal; postedAtEpoch: number }>();
  for (const transaction of transactions) {
    if (
      transaction.accountIdentity !== balance.accountIdentity ||
      transaction.currency !== balance.currency ||
      transaction.pending === true
    ) {
      continue;
    }
    const amount = exactDecimal(transaction.amount);
    const postedAtEpoch = transaction.postedAtEpoch;
    if (
      !transaction.fitid ||
      !amount ||
      postedAtEpoch === undefined ||
      !isValidEpoch(postedAtEpoch, false) ||
      records.has(transaction.fitid)
    ) {
      valid = false;
      continue;
    }
    records.set(transaction.fitid, { amount, postedAtEpoch });
  }
  return { valid, records };
}

function identityKey(accountIdentity: string, fitid: string): string {
  return JSON.stringify([accountIdentity, fitid]);
}

function accountKey(accountIdentity: string, currency: string): string {
  return JSON.stringify([accountIdentity, currency]);
}

function exactDecimal(value: string): ExactDecimal | undefined {
  if (!DECIMAL.test(value)) return undefined;
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integer = "0", fraction = ""] = unsigned.split(".");
  const coefficient = BigInt(`${integer}${fraction}`);
  return { coefficient: negative ? -coefficient : coefficient, scale: fraction.length };
}

function add(left: ExactDecimal | undefined, right: ExactDecimal): ExactDecimal {
  if (!left) return right;
  const scale = Math.max(left.scale, right.scale);
  return {
    coefficient:
      left.coefficient * 10n ** BigInt(scale - left.scale) +
      right.coefficient * 10n ** BigInt(scale - right.scale),
    scale,
  };
}

function subtract(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  const scale = Math.max(left.scale, right.scale);
  return {
    coefficient:
      left.coefficient * 10n ** BigInt(scale - left.scale) -
      right.coefficient * 10n ** BigInt(scale - right.scale),
    scale,
  };
}

function negate(value: ExactDecimal): ExactDecimal {
  return { coefficient: -value.coefficient, scale: value.scale };
}

function decimalsEqual(left: ExactDecimal, right: ExactDecimal): boolean {
  const scale = Math.max(left.scale, right.scale);
  return (
    left.coefficient * 10n ** BigInt(scale - left.scale) ===
    right.coefficient * 10n ** BigInt(scale - right.scale)
  );
}

function formatDecimal(value: ExactDecimal): string {
  if (value.scale === 0) return value.coefficient.toString();
  const negative = value.coefficient < 0n;
  const digits = (negative ? -value.coefficient : value.coefficient)
    .toString()
    .padStart(value.scale + 1, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}`;
}

function validPostingEvidence(transaction: ParsedTransaction): boolean {
  if (transaction.postedAtEpoch === undefined) {
    return Boolean(transaction.postedAt && isIsoDate(transaction.postedAt));
  }
  if (!isValidEpoch(transaction.postedAtEpoch, true)) return false;
  if (transaction.postedAtEpoch === 0) {
    return transaction.pending === true && transaction.postedAt === undefined;
  }
  return transaction.postedAt === epochToIso(transaction.postedAtEpoch).slice(0, 10);
}

function isValidEpoch(value: number, allowZero: boolean): boolean {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) return false;
  return !Number.isNaN(new Date(value * 1000).valueOf());
}

function epochToIso(value: number): string {
  return new Date(value * 1000).toISOString();
}

function isIsoTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
