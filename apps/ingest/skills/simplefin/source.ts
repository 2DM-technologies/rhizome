import {
  ConnectedSourceActionRequired,
  CredentialConnectionError,
  type CredentialedSourceSkill,
  type SourceJsonValue,
} from "../../connected-sources/types.ts";
import type { ParsedAccountBalance, ParsedTransactions } from "../../transactions/types.ts";
import type { HistoryRecoveryEvidence, VerifyReport } from "../../transactions/verify.ts";
import { SimpleFinClient, SimpleFinClientError, type SimpleFinClientOptions } from "./client.ts";
import {
  connectSimpleFinRequestSchema,
  SIMPLEFIN_CONNECTOR_VERSION,
  SIMPLEFIN_SKILL_ID,
  simpleFinSourceConfigSchema,
  type ConnectSimpleFinRequest,
  type SimpleFinSourceConfig,
} from "./contracts.ts";
import { simpleFinParser } from "./scripts/parse-simplefin.ts";

const FETCH_ATTEMPTS = 24;
const FETCH_WINDOW_HOURS = 24;
const HISTORY_WINDOW_SECONDS = 45 * 24 * 60 * 60;
const HISTORY_OVERLAP_SECONDS = 15 * 24 * 60 * 60;
const MAX_HISTORY_WINDOW_SECONDS = 90 * 24 * 60 * 60;

export interface SimpleFinHistoryPlan {
  historyRecovery?: HistoryRecoveryEvidence;
  previous?: ParsedTransactions;
  startDateEpoch: number;
}

export function createSimpleFinSkill(options: SimpleFinClientOptions): CredentialedSourceSkill {
  const client = new SimpleFinClient(options);

  return {
    skillId: SIMPLEFIN_SKILL_ID,
    displayName: "SimpleFIN",
    manifest: {
      skill_id: SIMPLEFIN_SKILL_ID,
      label: "SimpleFIN",
      description:
        "Connect financial accounts with a one-time SimpleFIN Bridge setup token, then review transactions before importing them.",
      source_kind: "credentialed_remote",
      connector_version: SIMPLEFIN_CONNECTOR_VERSION,
      parser: { name: simpleFinParser.name, version: simpleFinParser.version },
      connection: {
        claim_policy: { kind: "single_use_global", attempts: 10, window_hours: 1 },
      },
      input_fields: [
        {
          name: "setup_token",
          label: "SimpleFIN setup token",
          target: "connection",
          control: "text",
          required: true,
          secret: true,
          placeholder: "Paste setup token",
          help_text: "Create a one-time token in SimpleFIN Bridge.",
          help_url: "https://bridge.simplefin.org/simplefin/create",
        },
      ],
      review_actions: ["review_import", "refresh_source"],
    },
    parser: simpleFinParser,
    connection: {
      claimPolicy: { kind: "single_use_global", attempts: 10, windowHours: 1 },
      requestSchema: connectSimpleFinRequestSchema,
      prepare(value) {
        const input = connectRequest(value);
        let replayKey: string;
        try {
          replayKey = client.canonicalizeSetupToken(input.setup_token);
        } catch (error) {
          throw credentialConnectionError(error, "SimpleFIN could not validate this setup token");
        }
        return {
          replayKey,
          async acquire() {
            try {
              return { secret: await client.claimSetupToken(input.setup_token) };
            } catch (error) {
              throw credentialConnectionError(
                error,
                "SimpleFIN could not exchange this setup token; verify the connection and try again",
              );
            }
          },
        };
      },
    },
    fetchPolicy: {
      attempts: FETCH_ATTEMPTS,
      windowHours: FETCH_WINDOW_HOURS,
    },
    capture: {
      mime: "application/json",
      label: (fetchUuid) => `simplefin-${fetchUuid}.json`,
    },
    parseConfig: parseSimpleFinConfig,
    normalize(parsed, config) {
      return filterSimpleFinTransactions(parsed, parseSimpleFinConfig(config));
    },
    prepareFetch({ config, endDateEpoch, previous, resume }) {
      const normalizedConfig = parseSimpleFinConfig(config);
      const rebaseline = isRebaselineResume(resume);
      const history = planSimpleFinHistory(previous, endDateEpoch, rebaseline);
      return {
        retrieve(secret) {
          return client.fetchAccounts(secret, {
            ...(normalizedConfig.accounts
              ? { accountIds: normalizedConfig.accounts.map(({ account_id }) => account_id) }
              : {}),
            startDateEpoch: history.startDateEpoch,
            endDateEpoch,
            includePending: normalizedConfig.include_pending === true,
          });
        },
        verifyOptions: {
          ...(history.previous ? { previous: history.previous } : {}),
          ...(history.previous ? { historyStartEpoch: history.startDateEpoch } : {}),
          ...(history.historyRecovery ? { historyRecovery: history.historyRecovery } : {}),
        },
        ...(rebaseline ? { actionEvidence: { kind: "review_import" as const } } : {}),
      };
    },
    verificationError: simpleFinVerificationAction,
    identitySourceProperties(properties) {
      const {
        account_balance: _accountBalance,
        account_balance_date: _accountBalanceDate,
        account_balance_date_epoch: _accountBalanceDateEpoch,
        simplefin_account_extra: _accountExtra,
        ...identityProperties
      } = properties;
      return identityProperties;
    },
  };
}

/** Applies the owner-selected composite account and pending policy deterministically. */
export function filterSimpleFinTransactions(
  parsed: ParsedTransactions,
  config: SimpleFinSourceConfig,
): ParsedTransactions {
  const selectedAccounts = config.accounts
    ? new Set(
        config.accounts.map(({ connection_id, account_id }) =>
          JSON.stringify([connection_id, account_id]),
        ),
      )
    : undefined;
  const hasProviderErrors =
    (parsed.providerErrors?.structured.length ?? 0) > 0 ||
    (parsed.providerErrors?.legacyCount ?? 0) > 0;
  if (selectedAccounts && !hasProviderErrors) {
    const returnedAccounts = new Set(
      (parsed.accountBalances ?? [])
        .map(({ accountIdentity }) => accountIdentity)
        .filter((identity): identity is string => Boolean(identity)),
    );
    const missingAccountCount = [...selectedAccounts].filter(
      (identity) => !returnedAccounts.has(identity),
    ).length;
    if (missingAccountCount > 0) {
      throw new Error(
        `SimpleFIN response omitted ${missingAccountCount} selected account${missingAccountCount === 1 ? "" : "s"}`,
      );
    }
  }
  const includesAccount = (accountIdentity: string | undefined): boolean =>
    Boolean(accountIdentity) &&
    (!selectedAccounts || selectedAccounts.has(accountIdentity as string));
  const transactions = parsed.transactions.filter(
    (transaction) =>
      includesAccount(transaction.accountIdentity) &&
      (config.include_pending === true || transaction.pending !== true),
  );
  const countByAccount = new Map<string, number>();
  for (const transaction of transactions) {
    const identity = transaction.accountIdentity!;
    countByAccount.set(identity, (countByAccount.get(identity) ?? 0) + 1);
  }
  const accountBalances: ParsedAccountBalance[] | undefined = parsed.accountBalances
    ?.filter((balance) => includesAccount(balance.accountIdentity))
    .map((balance) => ({
      ...balance,
      sourceRecordCount: countByAccount.get(balance.accountIdentity) ?? 0,
    }));
  return {
    ...parsed,
    transactions,
    sourceRecordCount: transactions.length,
    ...(accountBalances ? { accountBalances } : {}),
  };
}

/**
 * Plans one exact response. The ordinary 45-day range grows to include the oldest selected-account
 * balance plus a 15-day overlap, but never exceeds the provider's documented 90-day limit.
 */
export function planSimpleFinHistory(
  previous: ParsedTransactions | undefined,
  endDateEpoch: number,
  rebaseline: boolean,
): SimpleFinHistoryPlan {
  if (!Number.isSafeInteger(endDateEpoch) || endDateEpoch <= 0) {
    throw new Error("SimpleFIN history end date is invalid");
  }
  const rollingStart = Math.max(0, endDateEpoch - HISTORY_WINDOW_SECONDS);
  if (!previous) {
    if (rebaseline) {
      throw new Error("SimpleFIN continuation has no baseline to review");
    }
    return { startDateEpoch: rollingStart };
  }

  const balances = previous.accountBalances ?? [];
  if (!balances.length) throw new Error("Previous connected capture has no account balances");
  const oldestBalanceAt = Math.min(...balances.map(({ balanceAtEpoch }) => balanceAtEpoch));
  if (!Number.isSafeInteger(oldestBalanceAt) || oldestBalanceAt <= 0) {
    throw new Error("Previous connected capture has an invalid balance date");
  }
  const preferredStart = Math.max(0, oldestBalanceAt - HISTORY_OVERLAP_SECONDS);
  const earliestSupportedStart = Math.max(0, endDateEpoch - MAX_HISTORY_WINDOW_SECONDS);
  const previousBalanceAt = new Date(oldestBalanceAt * 1_000).toISOString();

  if (rebaseline) {
    return {
      startDateEpoch: rollingStart,
      historyRecovery: {
        mode: "rebaseline",
        reason:
          oldestBalanceAt < earliestSupportedStart
            ? "simplefin_history_gap"
            : "unreconciled_backdated_activity",
        previous_balance_at: previousBalanceAt,
        history_resumes_at: new Date(rollingStart * 1_000).toISOString(),
      },
    };
  }

  if (oldestBalanceAt < earliestSupportedStart) {
    throw reviewImportRequired();
  }

  return {
    previous,
    startDateEpoch: Math.max(earliestSupportedStart, Math.min(rollingStart, preferredStart)),
  };
}

function parseSimpleFinConfig(value: unknown): SimpleFinSourceConfig {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw invalidStoredConfig();
  const record = value as Record<string, unknown>;
  const properties = simpleFinSourceConfigSchema.properties;
  if (Object.keys(record).some((key) => !(key in properties))) throw invalidStoredConfig();
  if (record.include_pending !== undefined && typeof record.include_pending !== "boolean") {
    throw invalidStoredConfig();
  }
  let accounts: SimpleFinSourceConfig["accounts"];
  if (record.accounts !== undefined) {
    if (
      !Array.isArray(record.accounts) ||
      record.accounts.length < simpleFinSourceConfigSchema.properties.accounts.minItems ||
      record.accounts.length > simpleFinSourceConfigSchema.properties.accounts.maxItems
    ) {
      throw invalidStoredConfig();
    }
    const seen = new Set<string>();
    accounts = record.accounts.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw invalidStoredConfig();
      }
      const selector = value as Record<string, unknown>;
      const selectorSchema = simpleFinSourceConfigSchema.properties.accounts.items;
      if (
        Object.keys(selector).some((key) => !(key in selectorSchema.properties)) ||
        typeof selector.connection_id !== "string" ||
        selector.connection_id.length < selectorSchema.properties.connection_id.minLength ||
        selector.connection_id.length > selectorSchema.properties.connection_id.maxLength ||
        typeof selector.account_id !== "string" ||
        selector.account_id.length < selectorSchema.properties.account_id.minLength ||
        selector.account_id.length > selectorSchema.properties.account_id.maxLength
      ) {
        throw invalidStoredConfig();
      }
      const composite = JSON.stringify([selector.connection_id, selector.account_id]);
      if (seen.has(composite)) throw invalidStoredConfig();
      seen.add(composite);
      return {
        connection_id: selector.connection_id,
        account_id: selector.account_id,
      };
    });
  }
  return {
    ...(accounts ? { accounts } : {}),
    ...(record.include_pending === undefined ? {} : { include_pending: record.include_pending }),
  };
}

function simpleFinVerificationAction(
  report: VerifyReport,
): ConnectedSourceActionRequired | undefined {
  const failed = report.checks.filter(({ ok }) => !ok);
  if (failed.length !== 1 || failed[0]?.name !== "balance_delta") return undefined;
  return reviewImportRequired();
}

function reviewImportRequired(): ConnectedSourceActionRequired {
  return new ConnectedSourceActionRequired(
    SIMPLEFIN_SKILL_ID,
    "review_import",
    { mode: "rebaseline" },
    "SimpleFIN history requires review",
    "Review and acknowledge a new transaction-history baseline before importing this connected source.",
  );
}

function isRebaselineResume(value: SourceJsonValue | undefined): boolean {
  if (value === undefined) return false;
  if (
    value !== null &&
    !Array.isArray(value) &&
    typeof value === "object" &&
    Object.keys(value).length === 1 &&
    value.mode === "rebaseline"
  ) {
    return true;
  }
  throw new Error("SimpleFIN continuation resume is invalid");
}

function connectRequest(value: unknown): ConnectSimpleFinRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidSetupToken();
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => key !== "setup_token") ||
    typeof record.setup_token !== "string" ||
    record.setup_token.length < connectSimpleFinRequestSchema.properties.setup_token.minLength ||
    record.setup_token.length > connectSimpleFinRequestSchema.properties.setup_token.maxLength
  ) {
    throw invalidSetupToken();
  }
  return { setup_token: record.setup_token };
}

function invalidSetupToken(): CredentialConnectionError {
  return new CredentialConnectionError(
    "invalid_setup_token",
    "rejected",
    "SimpleFIN setup token is invalid",
  );
}

function credentialConnectionError(
  error: unknown,
  fallbackDetail: string,
): CredentialConnectionError {
  const code = error instanceof SimpleFinClientError ? error.kind : "claim_failed";
  const disposition =
    error instanceof SimpleFinClientError &&
    (error.kind === "invalid_setup_token" || error.kind === "claim_rejected")
      ? "rejected"
      : "ambiguous";
  return new CredentialConnectionError(
    code,
    disposition,
    error instanceof SimpleFinClientError ? error.message : fallbackDetail,
  );
}

function invalidStoredConfig(): Error {
  return new Error("Stored SimpleFIN source configuration is invalid");
}
