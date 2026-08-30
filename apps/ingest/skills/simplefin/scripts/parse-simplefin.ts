import type {
  ParsedAccountBalance,
  ParsedProviderErrors,
  ParsedProviderIssue,
  ParsedTransaction,
  ParsedTransactions,
  TransactionParser,
} from "../../../transactions/types.ts";
import { SIMPLEFIN_PARSER_NAME, SIMPLEFIN_PARSER_VERSION } from "../contracts.ts";

interface ParsedConnection {
  connId: string;
  orgId: string;
}

const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const ISO_CURRENCY = /^[A-Z]{3}$/;
const PROVIDER_ERROR_CODE = /^(?:gen|con|act)\.(?:[A-Za-z0-9_-]+)?$/;

export const simpleFinParser: TransactionParser = {
  name: SIMPLEFIN_PARSER_NAME,
  version: SIMPLEFIN_PARSER_VERSION,
  async parse(bytes) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      throw new Error("SimpleFIN v2 response is not valid JSON");
    }
    const accountSet = objectValue(decoded, "SimpleFIN v2 Account Set");
    const errlist = requiredArray(accountSet, "errlist", "SimpleFIN v2 Account Set");
    const connectionValues = requiredArray(accountSet, "connections", "SimpleFIN v2 Account Set");
    const accountValues = requiredArray(accountSet, "accounts", "SimpleFIN v2 Account Set");
    if (!connectionValues.length) throw new Error("SimpleFIN v2 response contains no connections");
    if (!accountValues.length) throw new Error("SimpleFIN v2 response contains no accounts");

    const connections = new Map<string, ParsedConnection>();
    for (const [index, value] of connectionValues.entries()) {
      const label = `SimpleFIN connection ${index + 1}`;
      const connection = objectValue(value, label);
      const connId = requiredString(connection, "conn_id", label);
      requiredString(connection, "name", label);
      const orgId = requiredString(connection, "org_id", label);
      const sfinUrl = requiredString(connection, "sfin_url", label);
      assertHttpsUrl(sfinUrl, `${label} sfin_url`);
      if (connection.org_url !== undefined) requiredString(connection, "org_url", label);
      if (connections.has(connId)) throw new Error("SimpleFIN v2 repeats a connection id");
      connections.set(connId, { connId, orgId });
    }

    const providerErrors = parseProviderErrors(accountSet, errlist);
    const accountIdentities = new Set<string>();
    const transactions: ParsedTransaction[] = [];
    const accountBalances: ParsedAccountBalance[] = [];
    let sourceRecordCount = 0;

    for (const [accountIndex, value] of accountValues.entries()) {
      const label = `SimpleFIN account ${accountIndex + 1}`;
      const account = objectValue(value, label);
      const accountId = requiredString(account, "id", label);
      requiredString(account, "name", label);
      const connId = requiredString(account, "conn_id", label);
      const connection = connections.get(connId);
      if (!connection) throw new Error(`${label} references an unknown connection`);
      const currency = requiredString(account, "currency", label);
      if (/^https?:\/\//i.test(currency)) {
        throw new Error(`${label} uses an unsupported custom currency URL`);
      }
      if (!ISO_CURRENCY.test(currency)) throw new Error(`${label} has an invalid ISO currency`);
      const balance = requiredDecimal(account, "balance", label);
      if (account["available-balance"] !== undefined) {
        requiredDecimal(account, "available-balance", label);
      }
      const balanceAtEpoch = requiredEpoch(account, "balance-date", label, false);
      const balanceAt = epochToIso(balanceAtEpoch);
      const accountIdentity = JSON.stringify([connId, accountId]);
      if (accountIdentities.has(accountIdentity)) {
        throw new Error("SimpleFIN v2 repeats an account within a connection");
      }
      accountIdentities.add(accountIdentity);
      const transactionValues = optionalArray(account, "transactions", label) ?? [];
      sourceRecordCount += transactionValues.length;
      const accountExtra = optionalObject(account, "extra", label);

      for (const [transactionIndex, transactionValue] of transactionValues.entries()) {
        const transactionLabel = `${label} transaction ${transactionIndex + 1}`;
        const transaction = objectValue(transactionValue, transactionLabel);
        const transactionId = requiredString(transaction, "id", transactionLabel);
        const postedAtEpoch = requiredEpoch(transaction, "posted", transactionLabel, true);
        const amount = requiredDecimal(transaction, "amount", transactionLabel);
        const rawDescription = requiredString(transaction, "description", transactionLabel);
        const pending = optionalBoolean(transaction, "pending", transactionLabel);
        if (postedAtEpoch === 0 && pending !== true) {
          throw new Error(`${transactionLabel} has posted=0 without pending=true`);
        }
        const transactedAtEpoch =
          transaction.transacted_at === undefined
            ? undefined
            : requiredEpoch(transaction, "transacted_at", transactionLabel, true);
        const transactionExtra = optionalObject(transaction, "extra", transactionLabel);
        const postedTimestamp = postedAtEpoch === 0 ? undefined : epochToIso(postedAtEpoch);
        transactions.push({
          amount,
          currency,
          ...(postedTimestamp ? { postedAt: postedTimestamp.slice(0, 10) } : {}),
          postedAtEpoch,
          ...(pending !== undefined ? { pending } : {}),
          rawDescription,
          fitid: transactionId,
          accountIdentity,
          keys: {
            simplefin_connection_id: connection.connId,
            simplefin_account_id: accountId,
            simplefin_transaction_id: transactionId,
          },
          sourceProperties: {
            simplefin_connection_id: connection.connId,
            simplefin_organization_id: connection.orgId,
            simplefin_account_id: accountId,
            simplefin_transaction_id: transactionId,
            account_balance: balance,
            account_balance_date: balanceAt,
            account_balance_date_epoch: balanceAtEpoch,
            posted_at_epoch: postedAtEpoch,
            ...(pending !== undefined ? { pending } : {}),
            ...(transactedAtEpoch !== undefined
              ? {
                  transacted_at: epochToIso(transactedAtEpoch),
                  transacted_at_epoch: transactedAtEpoch,
                }
              : {}),
            ...(accountExtra ? { simplefin_account_extra: accountExtra } : {}),
            ...(transactionExtra ? { simplefin_transaction_extra: transactionExtra } : {}),
          },
        });
      }

      accountBalances.push({
        accountIdentity,
        currency,
        balance,
        balanceAt,
        balanceAtEpoch,
        sourceRecordCount: transactionValues.length,
      });
    }

    return {
      transactions,
      sourceRecordCount,
      allowEmpty: true,
      accountBalances,
      providerErrors,
    } satisfies ParsedTransactions;
  },
};

function parseProviderErrors(
  accountSet: Record<string, unknown>,
  errlist: unknown[],
): ParsedProviderErrors {
  const structured: ParsedProviderIssue[] = errlist.map((value, index) => {
    const label = `SimpleFIN provider error ${index + 1}`;
    const error = objectValue(value, label);
    const code = requiredString(error, "code", label);
    if (!PROVIDER_ERROR_CODE.test(code)) throw new Error(`${label} has an invalid code`);
    requiredString(error, "msg", label);
    const connectionReference = optionalString(error, "conn_id", label);
    const accountReference = optionalString(error, "account_id", label);
    return {
      code,
      scope: code.startsWith("gen.")
        ? "general"
        : code.startsWith("con.")
          ? "connection"
          : code.startsWith("act.")
            ? "account"
            : "unknown",
      hasConnectionReference: connectionReference !== undefined,
      hasAccountReference: accountReference !== undefined,
    };
  });
  const legacyErrors = optionalArray(accountSet, "errors", "SimpleFIN v2 Account Set") ?? [];
  for (const [index, value] of legacyErrors.entries()) {
    if (typeof value !== "string") {
      throw new Error(`SimpleFIN legacy provider error ${index + 1} must be a string`);
    }
  }
  return { structured, legacyCount: legacyErrors.length };
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredArray(parent: Record<string, unknown>, key: string, label: string): unknown[] {
  const value = parent[key];
  if (!Array.isArray(value)) throw new Error(`${label} is missing required ${key} array`);
  return value;
}

function optionalArray(
  parent: Record<string, unknown>,
  key: string,
  label: string,
): unknown[] | undefined {
  const value = parent[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${label} ${key} must be an array`);
  return value;
}

function requiredString(parent: Record<string, unknown>, key: string, label: string): string {
  const value = parent[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is missing required ${key}`);
  }
  return value;
}

function optionalString(
  parent: Record<string, unknown>,
  key: string,
  label: string,
): string | undefined {
  if (parent[key] === undefined) return undefined;
  return requiredString(parent, key, label);
}

function requiredDecimal(parent: Record<string, unknown>, key: string, label: string): string {
  const value = requiredString(parent, key, label);
  if (!DECIMAL.test(value)) throw new Error(`${label} has invalid ${key} decimal`);
  return value;
}

function requiredEpoch(
  parent: Record<string, unknown>,
  key: string,
  label: string,
  allowZero: boolean,
): number {
  const value = parent[key];
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < (allowZero ? 0 : 1) ||
    !isValidEpoch(value)
  ) {
    throw new Error(`${label} has invalid ${key} timestamp`);
  }
  return value;
}

function optionalBoolean(
  parent: Record<string, unknown>,
  key: string,
  label: string,
): boolean | undefined {
  const value = parent[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${label} ${key} must be boolean`);
  return value;
}

function optionalObject(
  parent: Record<string, unknown>,
  key: string,
  label: string,
): Record<string, unknown> | undefined {
  const value = parent[key];
  if (value === undefined) return undefined;
  return objectValue(value, `${label} ${key}`);
}

function assertHttpsUrl(value: string, label: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is not a URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(`${label} must be a credential-free HTTPS URL`);
  }
}

function isValidEpoch(value: number): boolean {
  const date = new Date(value * 1000);
  return !Number.isNaN(date.valueOf());
}

function epochToIso(value: number): string {
  return new Date(value * 1000).toISOString();
}
