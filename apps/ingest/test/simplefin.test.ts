import { describe, expect, test } from "bun:test";

import { simpleFinParser } from "../skills/simplefin/scripts/parse-simplefin.ts";
import { parserFor } from "../src/registry.ts";
import { verifyTransactions } from "../verify/transactions.ts";

describe("M2 SimpleFIN v2 committed parser", () => {
  test("parses the synthetic Account Set deterministically with stable keys and source facts", async () => {
    const bytes = await fixtureBytes("accounts-current-v2.json");
    const first = await simpleFinParser.parse(bytes);
    const second = await simpleFinParser.parse(bytes);

    expect(first).toEqual(second);
    expect(simpleFinParser.version).toBe("simplefin@2.0.0");
    expect(parserFor("simplefin")).toBe(simpleFinParser);
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

  test("fails closed when a previously selected account disappears", async () => {
    const previous = await parseFixture("accounts-previous-v2.json");
    const current = await parseFixture("missing-previous-account-v2.json");
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
    const first = await parseFixture("new-account-v2.json");
    const second = await parseFixture("new-account-v2.json");
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

    const duplicate = await parseFixture("duplicate-transaction-v2.json");
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
    await expect(parseFixture("orphan-account-v2.json")).rejects.toThrow("unknown connection");
    await expect(parseFixture("malformed-decimal-v2.json")).rejects.toThrow(
      "invalid amount decimal",
    );
    await expect(parseFixture("malformed-timestamp-v2.json")).rejects.toThrow(
      "invalid posted timestamp",
    );
    await expect(parseFixture("custom-currency-v2.json")).rejects.toThrow(
      "unsupported custom currency URL",
    );
  });

  test("requires the v2 Account Set arrays and required transaction fields", async () => {
    await expect(simpleFinParser.parse(new TextEncoder().encode("{}"))).rejects.toThrow(
      "required errlist array",
    );

    const current = JSON.parse(await fixtureText("accounts-current-v2.json")) as {
      accounts: Array<{ transactions: Array<Record<string, unknown>> }>;
    };
    delete current.accounts[0]!.transactions[0]!.description;
    await expect(
      simpleFinParser.parse(new TextEncoder().encode(JSON.stringify(current))),
    ).rejects.toThrow("required description");
  });
});

function fixture(name: string): URL {
  return new URL(`../skills/simplefin/fixtures/${name}`, import.meta.url);
}

async function fixtureText(name: string): Promise<string> {
  return Bun.file(fixture(name)).text();
}

async function fixtureBytes(name: string): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(fixture(name)).arrayBuffer());
}

async function parseFixture(name: string) {
  return simpleFinParser.parse(await fixtureBytes(name));
}
