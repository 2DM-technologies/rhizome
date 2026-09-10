# Transaction VERIFY

All OFX and SimpleFIN captures pass the canonical transaction IR through the executable rules
in `verify.ts` before compilation is accepted. The report accounts for candidate/source counts,
required monetary and posting fields, per-account transaction identity, exact currency totals, and
any statement, account-balance, provider-error, or history-recovery evidence supplied by the source.
