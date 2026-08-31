# QFX/OFX transaction ingestion

Version: `ofx@1.1.0`

This committed parser accepts bank-statement QFX/OFX SGML with one or more closed `STMTRS`
aggregates. Each statement requires an ISO `CURDEF`, a complete `BANKACCTFROM` (`BANKID`, `ACCTID`,
and `ACCTTYPE`), a dated `BANKTRANLIST`, and a dated `LEDGERBAL`. Each `STMTTRN` requires
`DTPOSTED`, `TRNAMT`, and `FITID` and becomes one zero-element `transaction`. Transaction-level
currency overrides are outside this supported dialect and fail closed.

FITID is retained as `keys.fitid`; the bank/account tuple is hashed before becoming
`keys.account_hash`. The closing ledger balance and statement period become VERIFY evidence, not
transaction properties.
