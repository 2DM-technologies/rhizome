# QFX/OFX VERIFY

The runtime must reject the preview unless all checks pass:

1. At least one `STMTTRN` record produces a candidate.
2. Candidate count equals the number of `STMTTRN` records.
3. Every candidate has a valid decimal amount, statement ISO currency, posting date, FITID, and
   complete account identity.
4. FITIDs are unique within an account.
5. Every parsed account group has one matching statement-balance record with the same candidate
   count.
6. Exact decimal totals are reported by currency and account. The review shows the source's closing
   ledger balance, the transaction total, and the implied opening balance (`closing - total`). OFX
   does not provide an independent opening balance, so VERIFY must not falsely require transaction
   total to equal closing balance.

The fixture total is USD `2493.50` across two transactions.
