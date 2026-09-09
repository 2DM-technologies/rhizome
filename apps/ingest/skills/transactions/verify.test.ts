import { describe, expect, test } from "bun:test";

import { verifyTransactions } from "./verify.ts";

describe("transaction VERIFY", () => {
  test("rejects invalid required transaction data", () => {
    const report = verifyTransactions({
      sourceRecordCount: 1,
      transactions: [
        {
          amount: "not-a-number",
          currency: "US",
          postedAt: "2026-13-40",
          fitid: "",
          accountIdentity: "",
        },
      ],
    });
    expect(report.ok).toBe(false);
    expect(report.totals_by_currency).toEqual({});
    for (const name of ["required_fields", "unique_transaction_ids", "amount_totals"] as const) {
      expect(report.checks).toContainEqual(expect.objectContaining({ name, ok: false }));
    }
  });

  test("scopes transaction IDs to a valid account identity", () => {
    const report = verifyTransactions({
      sourceRecordCount: 2,
      transactions: [
        {
          amount: "1.00",
          currency: "USD",
          postedAt: "2026-08-01",
          fitid: "shared",
          accountIdentity: "checking",
        },
        {
          amount: "2.00",
          currency: "USD",
          postedAt: "2026-08-02",
          fitid: "shared",
          accountIdentity: "savings",
        },
      ],
    });
    expect(report).toMatchObject({ ok: true, totals_by_currency: { USD: "3.00" } });
  });
});
