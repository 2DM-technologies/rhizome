# X import source family

This package owns one registered source definition:

- `x_oauth`, a credentialed remote source using the generic OAuth 2.0 PKCE capability.

The normalized post compiler stays at the package root rather than inside `oauth/`, so a second X
source could be added without moving it. The shared core classifies authored posts, filters replies and reposts, requires authored quote
commentary, orders newest-first, applies manifest limits, constructs ordered media elements, and
emits `candidate_bundle@1` with source VERIFY evidence.

The source definitions are activated only when their generic platform capabilities are complete.
