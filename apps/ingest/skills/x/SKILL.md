# X import source family

This package owns two independently registered source definitions that will share one normalized
post compiler:

- `x_archive`, a selectively preprocessed file source.
- `x_oauth`, a credentialed remote source using the generic OAuth 2.0 capability with S256 PKCE.

The shared core classifies authored posts, filters replies and reposts, requires authored quote
commentary, orders newest-first, applies manifest limits, constructs ordered media elements, and
emits `candidate_bundle@1` with source VERIFY evidence.

The source definitions are activated only when their generic platform capabilities are complete.
