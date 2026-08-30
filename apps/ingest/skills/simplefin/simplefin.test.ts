import { describe, expect, test } from "bun:test";

import { transactionParserFor } from "../../src/parser-catalog.ts";
import { verifyTransactions } from "../../transactions/verify.ts";
import { simpleFinParser } from "./scripts/parse-simplefin.ts";

describe("M2 SimpleFIN v2 committed parser", () => {
  test("parses the synthetic Account Set deterministically with stable keys and source facts", async () => {
    const bytes = await fixtureBytes("accounts-current-v2.json");
    const first = await simpleFinParser.parse(bytes);
    const second = await simpleFinParser.parse(bytes);

    expect(first).toEqual(second);
    expect(simpleFinParser.version).toBe("simplefin@2.0.0");
    expect(transactionParserFor("simplefin")).toBe(simpleFinParser);
    expect(first).toMatchObject({ sourceRecordCount: 4, allowEmpty: true });
    expect(first.transactions).toHaveLength(4);
    expect(first.transactions[0]).toMatchObject({
      amount: "150.00",
      currency: "USD",
      postedAt: "2026-08-05",
      postedAtEpoch: 1785931200,
      fitid: "shared-transaction",
      accountIdentity: '["conn-alpha","acct-shared"]',
      keys: {
        simplefin_connection_id: "conn-alpha",
        simplefin_account_id: "acct-shared",
        simplefin_transaction_id: "shared-transaction",
      },
      sourceProperties: {
        simplefin_connection_id: "conn-alpha",
        simplefin_organization_id: "org-alpha",
        simplefin_account_id: "acct-shared",
        simplefin_transaction_id: "shared-transaction",
        account_balance: "1125.50",
        account_balance_date: "2026-08-15T00:00:00.000Z",
        transacted_at: "2026-08-05T12:00:00.000Z",
      },
    });
    expect(first.transactions[2]).toMatchObject({
      postedAtEpoch: 0,
      pending: true,
      sourceProperties: { pending: true, posted_at_epoch: 0 },
    });
    expect(first.transactions[2]?.postedAt).toBeUndefined();
  });

  test("reconciles current balances against a previous connected snapshot", async () => {
    const previous = await parseFixture("accounts-previous-v2.json");
    const current = await parseFixture("accounts-current-v2.json");
    const previousReport = verifyTransactions(previous);
    expect(previousReport.ok).toBe(true);
    expect(previousReport.candidate_count).toBe(0);
    expect(previousReport.checks).toContainEqual(
      expect.objectContaining({ name: "non_empty", ok: true }),
    );

    const report = verifyTransactions(current, { previous });
    expect(report).toMatchObject({
      ok: true,
      candidate_count: 4,
      totals_by_currency: { USD: "110.51" },
      balance_delta_baselines: [],
      balance_delta_reconciliations: [
        {
          account_index: 1,
          currency: "USD",
          previous_balance: "1000.00",
          current_balance: "1125.50",
          balance_delta: "125.50",
          transaction_total: "125.50",
        },
        {
          account_index: 2,
          currency: "USD",
          previous_balance: "200.00",
          current_balance: "195.00",
          balance_delta: "-5.00",
          transaction_total: "-5.00",
        },
      ],
    });
    expect(report.checks).toContainEqual(
      expect.objectContaining({ name: "balance_delta", ok: true }),
    );

    const firstBalance = current.accountBalances?.[0];
    expect(firstBalance).toBeDefined();
    const mismatched = verifyTransactions(
      {
        ...current,
        accountBalances: firstBalance
          ? [{ ...firstBalance, balance: "1125.51" }, ...(current.accountBalances?.slice(1) ?? [])]
          : [],
      },
      { previous },
    );
    expect(mismatched.ok).toBe(false);
    expect(mismatched.checks).toContainEqual(
      expect.objectContaining({ name: "balance_delta", ok: false }),
    );
  });

  test("counts newly appearing backdated activity and exposes reviewed recovery when it is omitted", async () => {
    const previous = await parseFixture("accounts-previous-v2.json");
    const current = await parseFixture("accounts-current-v2.json");
    const first = current.transactions[0]!;
    const backdatedEpoch = 1_785_456_000; // 2026-07-31, before the previous Aug 1 balance.
    current.transactions[0] = {
      ...first,
      postedAt: "2026-07-31",
      postedAtEpoch: backdatedEpoch,
      sourceProperties: {
        ...first.sourceProperties,
        posted_at_epoch: backdatedEpoch,
      },
    };
    const backdated = verifyTransactions(current, { previous });
    expect(backdated.ok).toBe(true);
    expect(backdated.balance_delta_reconciliations[0]?.transaction_total).toBe("125.50");

    const omitted = {
      ...current,
      transactions: [],
      sourceRecordCount: 0,
      accountBalances: current.accountBalances?.map((balance) => ({
        ...balance,
        sourceRecordCount: 0,
      })),
    };
    expect(verifyTransactions(omitted, { previous }).ok).toBe(false);

    const historyRecovery = {
      mode: "rebaseline" as const,
      reason: "unreconciled_backdated_activity" as const,
      previous_balance_at: "2026-08-01T00:00:00.000Z",
      history_resumes_at: "2026-08-15T00:00:00.000Z",
    };
    const recovered = verifyTransactions(omitted, { historyRecovery });
    expect(recovered).toMatchObject({
      ok: true,
      history_recovery: historyRecovery,
      balance_delta_reconciliations: [],
      balance_delta_baselines: [{ account_index: 1 }, { account_index: 2 }],
    });
    expect(recovered.checks).toContainEqual(
      expect.objectContaining({ name: "history_recovery", ok: true }),
    );
  });

  test("reconciles corrected and removed settled transactions inside the request overlap", () => {
    const accountIdentity = '["conn-alpha","acct-shared"]';
    const previousBalanceAtEpoch = 1_785_542_400; // 2026-08-01
    const currentBalanceAtEpoch = 1_785_628_800; // 2026-08-02
    const postedAtEpoch = 1_785_456_000; // 2026-07-31
    const previous = {
      transactions: [
        {
          amount: "10.00",
          currency: "USD",
          postedAt: "2026-07-31",
          postedAtEpoch,
          fitid: "corrected-backdate",
          accountIdentity,
        },
      ],
      sourceRecordCount: 1,
      allowEmpty: true,
      accountBalances: [
        {
          accountIdentity,
          currency: "USD",
          balance: "100.00",
          balanceAt: "2026-08-01T00:00:00.000Z",
          balanceAtEpoch: previousBalanceAtEpoch,
          sourceRecordCount: 1,
        },
      ],
    };
    const corrected = {
      transactions: [{ ...previous.transactions[0]!, amount: "15.00" }],
      sourceRecordCount: 1,
      allowEmpty: true,
      accountBalances: [
        {
          ...previous.accountBalances[0]!,
          balance: "105.00",
          balanceAt: "2026-08-02T00:00:00.000Z",
          balanceAtEpoch: currentBalanceAtEpoch,
        },
      ],
    };
    const correctedReport = verifyTransactions(corrected, {
      previous,
      historyStartEpoch: postedAtEpoch,
    });
    expect(correctedReport.ok).toBe(true);
    expect(correctedReport.balance_delta_reconciliations[0]).toMatchObject({
      balance_delta: "5.00",
      transaction_total: "5.00",
    });

    const removed = {
      ...corrected,
      transactions: [],
      sourceRecordCount: 0,
      accountBalances: [
        {
          ...corrected.accountBalances[0]!,
          balance: "90.00",
          sourceRecordCount: 0,
        },
      ],
    };
    const removedReport = verifyTransactions(removed, {
      previous,
      historyStartEpoch: postedAtEpoch,
    });
    expect(removedReport.ok).toBe(true);
    expect(removedReport.balance_delta_reconciliations[0]).toMatchObject({
      balance_delta: "-10.00",
      transaction_total: "-10.00",
    });

    const outsideOverlap = {
      ...removed,
      accountBalances: [{ ...removed.accountBalances[0]!, balance: "100.00" }],
    };
    const outsideOverlapReport = verifyTransactions(outsideOverlap, {
      previous,
      historyStartEpoch: postedAtEpoch + 1,
    });
    expect(outsideOverlapReport.ok).toBe(true);
    expect(outsideOverlapReport.balance_delta_reconciliations[0]?.transaction_total).toBe("0.00");
  });

  test("fails closed when a previously selected account disappears", async () => {
    const previous = await parseFixture("accounts-previous-v2.json");
    const current = await parseCurrent((capture) => {
      capture.accounts.pop();
    });
    const report = verifyTransactions(current, { previous });

    expect(report.ok).toBe(false);
    expect(report.balance_delta_baselines).toEqual([]);
    expect(report.balance_delta_reconciliations.map(({ account_index }) => account_index)).toEqual([
      1,
    ]);
    expect(report.checks).toContainEqual({
      name: "balance_delta",
      ok: false,
      detail: "1 previously selected account is missing from the current response",
    });
  });

  test("records newly discovered accounts as deterministic index-only baseline evidence", async () => {
    const previous = await parseFixture("accounts-previous-v2.json");
    const first = await parseCurrent(addNewAccount);
    const second = await parseCurrent(addNewAccount);
    const firstReport = verifyTransactions(first, { previous });
    const secondReport = verifyTransactions(second, { previous });

    expect(first).toEqual(second);
    expect(firstReport).toEqual(secondReport);
    expect(firstReport.ok).toBe(true);
    expect(
      firstReport.balance_delta_reconciliations.map(({ account_index }) => account_index),
    ).toEqual([1, 3]);
    expect(firstReport.balance_delta_baselines).toEqual([{ account_index: 2 }]);
    expect(firstReport.checks).toContainEqual(
      expect.objectContaining({
        name: "balance_delta",
        ok: true,
        detail:
          "2 connected account balance deltas match non-pending transactions in their balance windows; 1 newly discovered account recorded as baseline evidence",
      }),
    );
    expect(JSON.stringify(firstReport)).not.toContain("acct-new");
    expect(JSON.stringify(firstReport)).not.toContain("conn-alpha");
  });

  test("accepts repeated transaction and account IDs only across composite accounts", async () => {
    const current = await parseFixture("accounts-current-v2.json");
    expect(verifyTransactions(current).ok).toBe(true);
    expect(current.transactions[0]?.fitid).toBe("shared-transaction");
    expect(current.transactions[3]?.fitid).toBe("shared-transaction");
    expect(current.transactions[0]?.accountIdentity).not.toBe(
      current.transactions[3]?.accountIdentity,
    );

    const duplicate = await parseCurrent((capture) => {
      const transactions = capture.accounts[0]!.transactions;
      transactions[1]!.id = transactions[0]!.id;
    });
    const duplicateReport = verifyTransactions(duplicate);
    expect(duplicateReport.ok).toBe(false);
    expect(duplicateReport.checks).toContainEqual(
      expect.objectContaining({ name: "unique_transaction_ids", ok: false }),
    );
  });

  test("turns provider errors into sanitized failing VERIFY evidence", async () => {
    const parsed = await parseFixture("provider-errors-v2.json");
    const report = verifyTransactions(parsed);
    expect(report).toMatchObject({
      ok: false,
      provider_error_evidence: {
        structured_count: 1,
        legacy_count: 1,
        connection_reference_count: 1,
        account_reference_count: 1,
        codes: ["act.missingdata"],
        scopes: ["account"],
      },
    });
    expect(report.checks).toContainEqual(
      expect.objectContaining({ name: "provider_errors", ok: false }),
    );
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("SENSITIVE PROVIDER MESSAGE");
    expect(serialized).not.toContain("SENSITIVE LEGACY ERROR");
  });

  test("fails closed on orphan accounts, malformed values, and custom currencies", async () => {
    await expect(
      parseCurrent((capture) => {
        capture.accounts[0]!.conn_id = "conn-missing";
      }),
    ).rejects.toThrow("unknown connection");
    await expect(
      parseCurrent((capture) => {
        capture.accounts[0]!.transactions[0]!.amount = "1,00";
      }),
    ).rejects.toThrow("invalid amount decimal");
    await expect(
      parseCurrent((capture) => {
        capture.accounts[0]!.transactions[0]!.posted = 1_785_931_200.5;
      }),
    ).rejects.toThrow("invalid posted timestamp");
    await expect(
      parseCurrent((capture) => {
        capture.accounts[0]!.currency = "https://rewards.example.invalid/currency";
      }),
    ).rejects.toThrow("unsupported custom currency URL");
  });

  test("requires the v2 Account Set arrays and required transaction fields", async () => {
    await expect(simpleFinParser.parse(new TextEncoder().encode("{}"))).rejects.toThrow(
      "required errlist array",
    );

    const current = await fixtureCapture("accounts-current-v2.json");
    delete current.accounts[0]!.transactions[0]!.description;
    await expect(simpleFinParser.parse(captureBytes(current))).rejects.toThrow(
      "required description",
    );
  });
});

interface SimpleFinFixture {
  errlist: unknown[];
  errors?: unknown[];
  connections: Array<Record<string, unknown>>;
  accounts: Array<
    Record<string, unknown> & {
      id: string;
      name: string;
      conn_id: string;
      currency: string;
      balance: string;
      transactions: Array<Record<string, unknown>>;
    }
  >;
}

function fixture(name: string): URL {
  return new URL(`./fixtures/${name}`, import.meta.url);
}

async function fixtureBytes(name: string): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(fixture(name)).arrayBuffer());
}

async function fixtureCapture(name: string): Promise<SimpleFinFixture> {
  return JSON.parse(await Bun.file(fixture(name)).text()) as SimpleFinFixture;
}

function captureBytes(capture: SimpleFinFixture): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(capture));
}

async function parseFixture(name: string) {
  return simpleFinParser.parse(await fixtureBytes(name));
}

async function parseCurrent(mutate: (capture: SimpleFinFixture) => void) {
  const capture = await fixtureCapture("accounts-current-v2.json");
  mutate(capture);
  return simpleFinParser.parse(captureBytes(capture));
}

function addNewAccount(capture: SimpleFinFixture): void {
  const account = structuredClone(capture.accounts[0]!);
  account.id = "acct-new";
  account.name = "Synthetic Savings";
  account.balance = "50.00";
  account["available-balance"] = "50.00";
  account.transactions = [];
  capture.accounts.splice(1, 0, account);
}
