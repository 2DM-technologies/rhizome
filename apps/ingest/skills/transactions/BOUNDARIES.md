# Transaction family boundaries

- The family root may own only canonical transaction contracts, shared VERIFY, and candidate
  compilation.
- OFX parsing stays inside its source directory.
- SimpleFIN claim exchange, configuration, capture, provider protocol, and error interpretation
  stay inside `simplefin/`.
- The host and server consume source manifests and `candidate_bundle@1`; they do not branch on a
  transaction source ID or provider.
