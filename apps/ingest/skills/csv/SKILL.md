# CSV transaction ingestion

Version: `csv@1.1.0`

This committed parser accepts two intentionally narrow UTF-8 CSV dialects:

- Rhizome bank CSV: the header contains `Date,Description,Amount,Currency,Transaction ID`;
  `Account ID` is optional. Dates use `YYYY-MM-DD`, amounts are signed base-10 decimals, currencies
  are ISO 4217 alpha codes, and transaction IDs are stable within an account.
- Financial Planning CSV: the exact header is
  `Status,Date,Description,Debit Category,Debit,Credit Category,Credit,Note`. Dates use
  `MM-DD-YYYY` or `MM/DD/YYYY`; exactly one unsigned debit or credit is present per row. Debits
  become negative USD amounts and credits become positive USD amounts. Because the format has no
  transaction ID, the parser derives a deterministic SHA-256 identifier from normalized date,
  description, and signed amount fields, plus an occurrence number for exact duplicate
  transactions. Status, category, and note changes therefore do not create a second transaction.

Unknown exports fail closed; M5 owns generated-parser support.

Each row becomes one zero-element `transaction`. Source values populate only `source.properties`.
The committed fixtures are synthetic and contain no user financial data.
