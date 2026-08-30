import { describe, expect, test } from "bun:test";

import { csvParser } from "../skills/csv/scripts/parse-csv.ts";
import { ofxParser } from "../skills/ofx/scripts/parse-ofx.ts";
import { verifyTransactions } from "../verify/transactions.ts";

describe("M2 committed transaction parsers", () => {
  test("the documented CSV dialect parses deterministically and passes VERIFY", async () => {
    const parsed = await csvParser.parse(
      new Uint8Array(await Bun.file(fixture("csv/fixtures/rhizome-bank.csv")).arrayBuffer()),
    );
    expect(parsed.transactions).toHaveLength(3);
    expect(parsed.transactions[2]).toMatchObject({
      amount: "-83.25",
      rawDescription: "GROCERY, MARKET",
      fitid: "csv-003",
    });
    expect(verifyTransactions(parsed)).toMatchObject({
      ok: true,
      source_record_count: 3,
      candidate_count: 3,
      totals_by_currency: { USD: "2410.25" },
    });
  });

  test("the Financial Planning dialect normalizes debit and credit rows deterministically", async () => {
    const bytes = new Uint8Array(
      await Bun.file(fixture("csv/fixtures/financial-planning.csv")).arrayBuffer(),
    );
    const first = await csvParser.parse(bytes);
    const second = await csvParser.parse(bytes);
    expect(first).toEqual(second);
    expect(first.transactions).toHaveLength(3);
    expect(first.transactions[0]).toMatchObject({
      amount: "-1200.0",
      currency: "USD",
      postedAt: "2026-12-02",
      accountIdentity: "financial-planning-usd",
      sourceProperties: { category: "Housing", status: "Cleared", amount_column: "debit" },
    });
    expect(first.transactions[2]).toMatchObject({
      amount: "2500.00",
      postedAt: "2026-12-15",
      sourceProperties: { category: "Income", amount_column: "credit" },
    });
    expect(
      first.transactions.every((transaction) =>
        transaction.fitid?.startsWith("financial-planning-"),
      ),
    ).toBe(true);
    const recategorized = await csvParser.parse(
      new TextEncoder().encode(
        [
          "Status,Date,Description,Debit Category,Debit,Credit Category,Credit,Note",
          ',12/02/2026,SYNTHETIC MONTHLY RENT,Updated category,"1,200.00",,,Updated note',
        ].join("\n"),
      ),
    );
    expect(recategorized.transactions[0]?.amount).toBe("-1200.00");
    expect(recategorized.transactions[0]?.fitid).toBe(first.transactions[0]?.fitid);
    expect(verifyTransactions(first)).toMatchObject({
      ok: true,
      source_record_count: 3,
      candidate_count: 3,
      totals_by_currency: { USD: "1216.75" },
    });
  });

  test("CSV amounts accept US thousands grouping and reject ambiguous comma formats", async () => {
    const grouped = await csvParser.parse(
      new TextEncoder().encode(
        [
          "Date,Description,Amount,Currency,Transaction ID,Account ID",
          '2026-01-01,GROUPED,"1,234.56",USD,grouped,checking',
        ].join("\n"),
      ),
    );
    expect(grouped.transactions[0]?.amount).toBe("1234.56");
    expect(verifyTransactions(grouped)).toMatchObject({
      ok: true,
      source_record_count: 1,
      candidate_count: 1,
      totals_by_currency: { USD: "1234.56" },
    });

    for (const amount of ["1.234,56", "12,34.56"]) {
      await expect(
        csvParser.parse(
          new TextEncoder().encode(
            [
              "Date,Description,Amount,Currency,Transaction ID,Account ID",
              `2026-01-01,INVALID,"${amount}",USD,invalid,checking`,
            ].join("\n"),
          ),
        ),
      ).rejects.toThrow("CSV row 2 has invalid Amount");
    }
  });

  test("QFX/OFX SGML parses transactions and account-scoped identifiers", async () => {
    const parsed = await ofxParser.parse(
      new Uint8Array(await Bun.file(fixture("ofx/fixtures/checking.qfx")).arrayBuffer()),
    );
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

  test("unknown CSV dialects and duplicate transaction IDs fail closed", async () => {
    await expect(
      csvParser.parse(new TextEncoder().encode("date,amount\n2026-01-01,1")),
    ).rejects.toThrow("Unsupported CSV dialect");
    const parsed = await csvParser.parse(
      new TextEncoder().encode(
        [
          "Date,Description,Amount,Currency,Transaction ID,Account ID",
          "2026-01-01,ONE,1.00,USD,repeated,checking",
          "2026-01-02,TWO,2.00,USD,repeated,checking",
        ].join("\n"),
      ),
    );
    expect(verifyTransactions(parsed)).toMatchObject({ ok: false });
  });

  test("VERIFY rejects empty sets and invalid required transaction data", async () => {
    const empty = await csvParser.parse(
      new TextEncoder().encode(
        "Status,Date,Description,Debit Category,Debit,Credit Category,Credit,Note",
      ),
    );
    const emptyReport = verifyTransactions(empty);
    expect(emptyReport.ok).toBe(false);
    expect(emptyReport.checks).toContainEqual(
      expect.objectContaining({ name: "non_empty", ok: false }),
    );

    const invalid = verifyTransactions({
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
    expect(invalid.ok).toBe(false);
    expect(invalid.totals_by_currency).toEqual({});
    for (const name of ["required_fields", "unique_transaction_ids", "amount_totals"] as const) {
      expect(invalid.checks).toContainEqual(expect.objectContaining({ name, ok: false }));
    }
  });

  test("transaction IDs are scoped to a valid account identity", () => {
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

  test("QFX/OFX rejects missing account structure, invalid dates, and duplicate transaction IDs", async () => {
    await expect(parseOfxFixture("missing-account.qfx")).rejects.toThrow("BANKACCTFROM");
    await expect(parseOfxFixture("invalid-date.qfx")).rejects.toThrow("invalid calendar date");

    const source = await Bun.file(fixture("ofx/fixtures/checking.qfx")).text();
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
    const duplicateReport = verifyTransactions(duplicate);
    expect(duplicateReport.ok).toBe(false);
    expect(duplicateReport.checks).toContainEqual(
      expect.objectContaining({ name: "unique_transaction_ids", ok: false }),
    );
  });

  test("QFX/OFX balance evidence must cover every parsed account group", async () => {
    const parsed = await parseOfxFixture("checking.qfx");
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

function fixture(path: string): URL {
  return new URL(`../skills/${path}`, import.meta.url);
}

async function parseOfxFixture(name: string) {
  return ofxParser.parse(
    new Uint8Array(await Bun.file(fixture(`ofx/fixtures/${name}`)).arrayBuffer()),
  );
}
