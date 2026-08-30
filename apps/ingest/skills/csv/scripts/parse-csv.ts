import type { ParsedTransactions, TransactionParser } from "../../../src/types.ts";

const RHIZOME_REQUIRED_HEADERS = ["Date", "Description", "Amount", "Currency", "Transaction ID"];
const FINANCIAL_PLANNING_HEADERS = [
  "Status",
  "Date",
  "Description",
  "Debit Category",
  "Debit",
  "Credit Category",
  "Credit",
  "Note",
];

export const csvParser: TransactionParser = {
  name: "csv",
  version: "csv@1.1.0",
  async parse(bytes) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
    const rows = parseCsv(text);
    const headers = rows.shift();
    if (!headers) throw new Error("CSV is empty");
    const dataRows = rows.filter((row) => row.some((cell) => cell.trim()));
    if (RHIZOME_REQUIRED_HEADERS.every((header) => headers.includes(header))) {
      return parseRhizomeCsv(headers, dataRows);
    }
    if (headersEqual(headers, FINANCIAL_PLANNING_HEADERS)) {
      return parseFinancialPlanningCsv(headers, dataRows);
    }
    throw new Error(`Unsupported CSV dialect: ${headers.join(",")}`);
  },
};

function parseRhizomeCsv(headers: string[], rows: string[][]): ParsedTransactions {
  const column = new Map(headers.map((header, index) => [header, index]));
  const value = (row: string[], name: string) => row[column.get(name)!]?.trim() ?? "";
  const transactions = rows.map((row, index) => {
    assertColumnCount(row, headers, index + 2);
    const amount = decimal(value(row, "Amount"), index + 2);
    const currency = value(row, "Currency").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`CSV row ${index + 2} has invalid currency`);
    const postedAt = isoDate(value(row, "Date"), index + 2);
    const fitid = value(row, "Transaction ID");
    if (!fitid) throw new Error(`CSV row ${index + 2} is missing Transaction ID`);
    const rawDescription = value(row, "Description");
    return {
      amount,
      currency,
      postedAt,
      rawDescription,
      fitid,
      ...(column.has("Account ID")
        ? { accountIdentity: value(row, "Account ID") || "default" }
        : { accountIdentity: "default" }),
    };
  });
  return { transactions, sourceRecordCount: transactions.length };
}

async function parseFinancialPlanningCsv(
  headers: string[],
  rows: string[][],
): Promise<ParsedTransactions> {
  const column = new Map(headers.map((header, index) => [header, index]));
  const value = (row: string[], name: string) => row[column.get(name)!]?.trim() ?? "";
  const occurrences = new Map<string, number>();
  const transactions: ParsedTransactions["transactions"] = [];
  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    assertColumnCount(row, headers, rowNumber);
    const debit = value(row, "Debit");
    const credit = value(row, "Credit");
    if (Boolean(debit) === Boolean(credit)) {
      throw new Error(`CSV row ${rowNumber} must contain exactly one of Debit or Credit`);
    }
    const unsignedAmount = decimal(debit || credit, rowNumber);
    if (unsignedAmount.startsWith("-")) {
      throw new Error(`CSV row ${rowNumber} has a signed Debit or Credit value`);
    }
    const amount = debit && unsignedAmount !== "0" ? `-${unsignedAmount}` : unsignedAmount;
    const rawDescription = value(row, "Description");
    if (!rawDescription) throw new Error(`CSV row ${rowNumber} is missing Description`);
    const postedAt = financialPlanningDate(value(row, "Date"), rowNumber);
    const category = value(row, debit ? "Debit Category" : "Credit Category");
    const status = value(row, "Status");
    const note = value(row, "Note");
    const fingerprint = await sha256(
      ["financial-planning-v1", postedAt, rawDescription, canonicalDecimal(amount)].join("\u001f"),
    );
    const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
    occurrences.set(fingerprint, occurrence);
    transactions.push({
      amount,
      currency: "USD",
      postedAt,
      rawDescription,
      fitid: `financial-planning-${fingerprint}-${occurrence}`,
      accountIdentity: "financial-planning-usd",
      sourceProperties: {
        ...(category ? { category } : {}),
        ...(status ? { status } : {}),
        ...(note ? { note } : {}),
        amount_column: debit ? "debit" : "credit",
      },
    });
  }
  return { transactions, sourceRecordCount: transactions.length };
}

function headersEqual(actual: string[], expected: string[]): boolean {
  return (
    actual.length === expected.length && actual.every((header, index) => header === expected[index])
  );
}

function assertColumnCount(row: string[], headers: string[], rowNumber: number): void {
  if (row.length !== headers.length) {
    throw new Error(`CSV row ${rowNumber} has ${row.length} columns; expected ${headers.length}`);
  }
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"') {
      if (field) throw new Error("Malformed CSV quote");
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function decimal(raw: string, row: number): string {
  const valid = /^-?(?:(?:0|[1-9][0-9]*)|(?:[1-9][0-9]{0,2}(?:,[0-9]{3})+))(?:\.[0-9]+)?$/.test(
    raw,
  );
  if (!valid) {
    throw new Error(`CSV row ${row} has invalid Amount`);
  }
  return raw.replaceAll(",", "");
}

function canonicalDecimal(value: string): string {
  if (!value.includes(".")) return value;
  const normalized = value.replace(/0+$/, "").replace(/\.$/, "");
  return normalized === "-0" ? "0" : normalized;
}

function isoDate(raw: string, row: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) throw new Error(`CSV row ${row} has invalid Date; expected YYYY-MM-DD`);
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== raw) {
    throw new Error(`CSV row ${row} has invalid Date`);
  }
  return raw;
}

function financialPlanningDate(raw: string, row: number): string {
  const match = /^(\d{2})([-/])(\d{2})\2(\d{4})$/.exec(raw);
  if (!match) throw new Error(`CSV row ${row} has invalid Date; expected MM-DD-YYYY`);
  const [, month, , day, year] = match;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== iso) {
    throw new Error(`CSV row ${row} has invalid Date`);
  }
  return iso;
}

async function sha256(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
