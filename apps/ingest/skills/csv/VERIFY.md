# CSV VERIFY

The runtime must reject the preview unless all checks pass:

1. At least one non-empty data row produces a candidate.
2. Candidate count equals the number of non-empty data rows.
3. Every candidate has a valid decimal amount, ISO currency, posting date, transaction ID, and
   account identity.
4. Transaction IDs—source-provided or deterministically derived—are present and unique within an
   account.
5. Exact decimal totals are reported by currency for human review.

The Rhizome fixture total is USD `2410.25` across three rows. The synthetic Financial Planning
fixture total is USD `1216.75` across three rows.
