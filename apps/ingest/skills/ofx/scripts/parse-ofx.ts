import type {
  ParsedStatementBalance,
  ParsedTransaction,
  ParsedTransactions,
  TransactionParser,
} from "../../../src/types.ts";

export const ofxParser: TransactionParser = {
  name: "ofx",
  version: "ofx@1.1.0",
  async parse(bytes) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const document = requiredAggregate(text, "OFX", "QFX/OFX document");
    const statementBlocks = aggregates(document, "STMTRS");
    if (!statementBlocks.length) throw new Error("QFX/OFX contains no STMTRS bank statements");

    const accountIdentities = new Set<string>();
    const transactions: ParsedTransaction[] = [];
    const statementBalances: ParsedStatementBalance[] = [];
    let sourceRecordCount = 0;

    for (const [statementIndex, statement] of statementBlocks.entries()) {
      const statementNumber = statementIndex + 1;
      const currency = requiredTag(
        statement,
        "CURDEF",
        `statement ${statementNumber}`,
      ).toUpperCase();
      if (!isCurrency(currency)) {
        throw new Error(`QFX/OFX statement ${statementNumber} has invalid CURDEF`);
      }

      const account = requiredAggregate(
        statement,
        "BANKACCTFROM",
        `QFX/OFX statement ${statementNumber}`,
      );
      const bankId = requiredTag(account, "BANKID", `statement ${statementNumber} BANKACCTFROM`);
      const accountId = requiredTag(account, "ACCTID", `statement ${statementNumber} BANKACCTFROM`);
      const accountType = requiredTag(
        account,
        "ACCTTYPE",
        `statement ${statementNumber} BANKACCTFROM`,
      ).toUpperCase();
      if (!ACCOUNT_TYPES.has(accountType)) {
        throw new Error(`QFX/OFX statement ${statementNumber} has invalid ACCTTYPE`);
      }
      const accountIdentity = [bankId, accountId, accountType].join(":");
      if (accountIdentities.has(accountIdentity)) {
        throw new Error("QFX/OFX repeats a BANKACCTFROM identity");
      }
      accountIdentities.add(accountIdentity);

      const transactionList = requiredAggregate(
        statement,
        "BANKTRANLIST",
        `QFX/OFX statement ${statementNumber}`,
      );
      const periodStart = ofxDate(
        requiredTag(transactionList, "DTSTART", `statement ${statementNumber} BANKTRANLIST`),
        `statement ${statementNumber} DTSTART`,
      );
      const periodEnd = ofxDate(
        requiredTag(transactionList, "DTEND", `statement ${statementNumber} BANKTRANLIST`),
        `statement ${statementNumber} DTEND`,
      );
      if (periodStart > periodEnd) {
        throw new Error(`QFX/OFX statement ${statementNumber} has DTSTART after DTEND`);
      }

      const transactionBlocks = aggregates(transactionList, "STMTTRN");
      if (!transactionBlocks.length) {
        throw new Error(`QFX/OFX statement ${statementNumber} contains no STMTTRN records`);
      }
      sourceRecordCount += transactionBlocks.length;
      for (const [transactionIndex, block] of transactionBlocks.entries()) {
        const label = `transaction ${transactionIndex + 1} in statement ${statementNumber}`;
        if (/<(?:ORIG)?CURRENCY(?:>|\s)/i.test(block)) {
          throw new Error(`QFX/OFX ${label} uses an unsupported transaction-level currency`);
        }
        const amount = requiredTag(block, "TRNAMT", label);
        if (!isDecimal(amount)) throw new Error(`QFX/OFX ${label} has invalid TRNAMT`);
        const fitid = requiredTag(block, "FITID", label);
        const postedAt = ofxDate(requiredTag(block, "DTPOSTED", label), `${label} DTPOSTED`);
        const description = [tag(block, "NAME"), tag(block, "MEMO")].filter(Boolean).join(" — ");
        transactions.push({
          amount,
          currency,
          postedAt,
          fitid,
          accountIdentity,
          ...(description ? { rawDescription: decodeEntities(description) } : {}),
          sourceProperties: {
            ...(tag(block, "TRNTYPE") ? { transaction_type: tag(block, "TRNTYPE") } : {}),
            ...(tag(block, "CHECKNUM") ? { check_number: tag(block, "CHECKNUM") } : {}),
          },
        });
      }

      const ledger = requiredAggregate(
        statement,
        "LEDGERBAL",
        `QFX/OFX statement ${statementNumber}`,
      );
      const ledgerBalance = requiredTag(ledger, "BALAMT", `statement ${statementNumber} LEDGERBAL`);
      if (!isDecimal(ledgerBalance)) {
        throw new Error(`QFX/OFX statement ${statementNumber} has invalid ledger BALAMT`);
      }
      const balanceAsOf = ofxDate(
        requiredTag(ledger, "DTASOF", `statement ${statementNumber} LEDGERBAL`),
        `statement ${statementNumber} ledger DTASOF`,
      );
      statementBalances.push({
        accountIdentity,
        currency,
        ledgerBalance,
        balanceAsOf,
        periodStart,
        periodEnd,
        sourceRecordCount: transactionBlocks.length,
      });
    }

    return { transactions, sourceRecordCount, statementBalances } satisfies ParsedTransactions;
  },
};

function aggregates(input: string, name: string): string[] {
  const matches = [
    ...input.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "gi")),
  ];
  const openings = [...input.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>`, "gi"))].length;
  const closings = [...input.matchAll(new RegExp(`<\\/${name}>`, "gi"))].length;
  if (openings !== matches.length || closings !== matches.length) {
    throw new Error(`QFX/OFX has malformed ${name} aggregate boundaries`);
  }
  return matches.map((match) => match[1]!);
}

function requiredAggregate(input: string, name: string, context: string): string {
  const matches = aggregates(input, name);
  if (matches.length !== 1) {
    throw new Error(`${context} must contain exactly one ${name} aggregate`);
  }
  return matches[0]!;
}

function tag(input: string, name: string): string | undefined {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>\\s*([^<\\r\\n]+)`, "i").exec(input);
  return match?.[1]?.trim();
}

function requiredTag(input: string, name: string, context: string): string {
  const values = [...input.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>\\s*([^<\\r\\n]+)`, "gi"))]
    .map((match) => match[1]?.trim())
    .filter(Boolean);
  if (values.length !== 1) {
    throw new Error(`QFX/OFX ${context} must contain exactly one ${name}`);
  }
  return values[0]!;
}

function isDecimal(value: string): boolean {
  return /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value);
}

function isCurrency(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

const ACCOUNT_TYPES = new Set(["CHECKING", "SAVINGS", "MONEYMRKT", "CD", "CREDITLINE"]);

function ofxDate(value: string, label: string): string {
  const match =
    /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})(?:\.\d+)?(?:\[[+-]?\d{1,2}(?::[A-Za-z]{1,5})?\])?)?$/.exec(
      value,
    );
  if (!match) throw new Error(`QFX/OFX ${label} has an invalid date`);
  const [, year, month, day, hour, minute, second] = match;
  const isoDate = `${year}-${month}-${day}`;
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== isoDate) {
    throw new Error(`QFX/OFX ${label} has an invalid calendar date`);
  }
  if (hour !== undefined && (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59)) {
    throw new Error(`QFX/OFX ${label} has an invalid time`);
  }
  return isoDate;
}

function decodeEntities(input: string): string {
  return input
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}
