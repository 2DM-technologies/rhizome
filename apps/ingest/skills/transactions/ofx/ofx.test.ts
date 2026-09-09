import { describe, expect, test } from "bun:test";

import { verifyTransactions } from "../verify.ts";
import { ofxParser } from "./parser.ts";

describe("M2 committed QFX/OFX parser", () => {
  test("parses transactions and account-scoped identifiers", async () => {
    const parsed = await parseFixture("checking.qfx");
    expect(parsed.transactions).toHaveLength(2);
    expect(parsed.transactions[1]).toMatchObject({
      amount: "-6.50",
      currency: "USD",
      postedAt: "2026-08-02",
      rawDescription: "COFFEE SHOP — LATTE",
      fitid: "ofx-002",
    });
    expect(verifyTransactions(parsed)).toMatchObject({
      ok: true,
      totals_by_currency: { USD: "2493.50" },
      balance_reconciliations: [
        {
          account_index: 1,
          currency: "USD",
          source_record_count: 2,
          candidate_count: 2,
          transaction_total: "2493.50",
          ledger_balance: "2493.50",
          implied_opening_balance: "0.00",
        },
      ],
    });
  });

  test("rejects missing account structure, invalid dates, and duplicate transaction IDs", async () => {
    const source = await fixtureText("checking.qfx");
    await expect(
      ofxParser.parse(
        new TextEncoder().encode(source.replace(/<BANKACCTFROM>[\s\S]*?<\/BANKACCTFROM>\n/, "")),
      ),
    ).rejects.toThrow("BANKACCTFROM");
    await expect(
      ofxParser.parse(new TextEncoder().encode(source.replace("20260801120000", "20261340120000"))),
    ).rejects.toThrow("invalid calendar date");
    await expect(
      ofxParser.parse(
        new TextEncoder().encode(source.replace("<ACCTTYPE>CHECKING", "<ACCTTYPE>WALLET")),
      ),
    ).rejects.toThrow("invalid ACCTTYPE");
    await expect(
      ofxParser.parse(
        new TextEncoder().encode(source.replace("</STMTTRN>\n</BANKTRANLIST>", "</BANKTRANLIST>")),
      ),
    ).rejects.toThrow("malformed STMTTRN aggregate boundaries");

    const duplicate = await ofxParser.parse(
      new TextEncoder().encode(source.replace("<FITID>ofx-002", "<FITID>ofx-001")),
    );
    const report = verifyTransactions(duplicate);
    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({ name: "unique_transaction_ids", ok: false }),
    );
  });

  test("balance evidence must cover every parsed account group", async () => {
    const parsed = await parseFixture("checking.qfx");
    const evidence = parsed.statementBalances?.[0];
    expect(evidence).toBeDefined();
    const report = verifyTransactions({
      ...parsed,
      statementBalances: evidence ? [{ ...evidence, sourceRecordCount: 1 }] : [],
    });
    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({ name: "balance_reconciliation", ok: false }),
    );
  });
});

function fixture(name: string): URL {
  return new URL(`./fixtures/${name}`, import.meta.url);
}

async function fixtureText(name: string): Promise<string> {
  return Bun.file(fixture(name)).text();
}

async function parseFixture(name: string) {
  return ofxParser.parse(new Uint8Array(await Bun.file(fixture(name)).arrayBuffer()));
}
