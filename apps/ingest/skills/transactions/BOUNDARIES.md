# Transaction family boundaries

- The family root may own only canonical transaction contracts, shared VERIFY, and candidate
  compilation.
- CSV and OFX parsing stays inside their source directories.
- SimpleFIN claim exchange, configuration, capture, provider protocol, and error interpretation
  stay inside `simplefin/`.
- The host and server consume source manifests and `candidate_bundle@1`; they do not branch on a
  transaction source ID or provider.
