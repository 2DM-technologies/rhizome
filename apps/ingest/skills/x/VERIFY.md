# X VERIFY

VERIFY fails closed unless:

- source/exclusion/eligibility counts reconcile;
- every selected record is authored by the captured account and is an original or a quote with
  authored commentary;
- selected IDs are unique and ordered newest-first with the post ID as tie-breaker;
- imported count equals `min(eligible count, configured cap)`;
- exact text is the first `text/plain` element for every candidate;
- included media preserves source order, MIME/kind, byte size, and SHA-256 evidence;
- every unavailable, unsupported, per-element-oversized, or aggregate-budgeted attachment has a
  declared deterministic omission reason.

The report includes examined, excluded, eligible, imported, cap, element-byte, and grouped media
omission counts.
