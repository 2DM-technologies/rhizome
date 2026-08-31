import { describe, expect, test } from "bun:test";

import { verifyTransactions } from "../verify.ts";
import { csvParser } from "./parser.ts";

describe("M2 committed CSV parser", () => {
  test("the documented CSV dialect parses deterministically and passes VERIFY", async () => {
    const parsed = await csvParser.parse(await fixtureBytes("rhizome-bank.csv"));
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
    const source = await fixtureText("financial-planning.csv");
    const bytes = new TextEncoder().encode(source);
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
        source.replace(
          "Cleared,12-02-2026,SYNTHETIC MONTHLY RENT,Housing,1200.0,,,",
          ",12-02-2026,SYNTHETIC MONTHLY RENT,Updated category,1200.0,,,Updated note",
        ),
      ),
    );
    expect(recategorized.transactions[0]?.amount).toBe("-1200.0");
    expect(recategorized.transactions[0]?.fitid).toBe(first.transactions[0]?.fitid);
    expect(verifyTransactions(first)).toMatchObject({
      ok: true,
      source_record_count: 3,
      candidate_count: 3,
      totals_by_currency: { USD: "1216.75" },
    });
  });

  test("amounts accept US thousands grouping and reject ambiguous comma formats", async () => {
    const source = await fixtureText("rhizome-bank.csv");
    const grouped = await csvParser.parse(
      new TextEncoder().encode(source.replace("2500.00", '"1,234.56"')),
    );
    expect(grouped.transactions[0]?.amount).toBe("1234.56");
    expect(verifyTransactions(grouped)).toMatchObject({
      ok: true,
      source_record_count: 3,
      candidate_count: 3,
      totals_by_currency: { USD: "1144.81" },
    });

    for (const amount of ["1.234,56", "12,34.56"]) {
      await expect(
        csvParser.parse(new TextEncoder().encode(source.replace("2500.00", `"${amount}"`))),
      ).rejects.toThrow("CSV row 2 has invalid Amount");
    }
  });

  test("unknown dialects and duplicate transaction IDs fail closed", async () => {
    await expect(
      csvParser.parse(new TextEncoder().encode("date,amount\n2026-01-01,1")),
    ).rejects.toThrow("Unsupported CSV dialect");

    const source = await fixtureText("rhizome-bank.csv");
    const duplicate = await csvParser.parse(
      new TextEncoder().encode(source.replace("csv-002", "csv-001")),
    );
    expect(verifyTransactions(duplicate)).toMatchObject({ ok: false });
  });

  test("an empty supported export fails VERIFY", async () => {
    const [header] = (await fixtureText("financial-planning.csv")).split("\n");
    const parsed = await csvParser.parse(new TextEncoder().encode(header ?? ""));
    const report = verifyTransactions(parsed);
    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(expect.objectContaining({ name: "non_empty", ok: false }));
  });
});

function fixture(name: string): URL {
  return new URL(`./fixtures/${name}`, import.meta.url);
}

async function fixtureText(name: string): Promise<string> {
  return Bun.file(fixture(name)).text();
}

async function fixtureBytes(name: string): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(fixture(name)).arrayBuffer());
}
