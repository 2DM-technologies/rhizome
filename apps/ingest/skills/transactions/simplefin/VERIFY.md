# SimpleFIN v2 VERIFY

The runtime must reject the preview or pull result unless all applicable checks pass:

1. The Account Set has valid connections and at least one account, with each account referencing a
   known connection.
2. Candidate count equals the number of transaction records. Zero candidates are permitted only
   for a connected SimpleFIN response carrying valid account balance snapshots.
3. Every candidate has a valid decimal amount, ISO currency, posting timestamp, transaction ID, and
   composite account identity. `posted=0` is valid only when `pending=true`.
4. Transaction IDs are unique within `(conn_id, account.id)`; the same transaction ID in another
   account is valid.
5. Every account balance and balance-date is valid and covers that account's emitted source-record
   count.
6. Any structured `errlist` entry or deprecated `errors` entry makes VERIFY fail. The report may
   contain only sanitized counts, machine error codes, and scopes—never provider `msg` strings or
   legacy error text.
7. When a previous parsed account snapshot is supplied, every account selected in that previous
   snapshot must still appear in the current response. A missing prior account fails closed.
8. For accounts present in both snapshots, the exact non-pending transaction total in
   `(previous balance-date, current balance-date]` must equal the exact balance delta. A newly
   discovered current account has no delta yet: it is accepted only as explicit baseline evidence,
   reported by its one-based current account index and never by provider account or connection ID.

The committed fixtures are synthetic. From the previous to current fixture, the first account moves
from USD `1000.00` to `1125.50` on USD `125.50` of non-pending transactions, and the second moves
from USD `200.00` to `195.00` on USD `-5.00`.
