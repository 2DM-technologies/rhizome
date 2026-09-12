# X import source family

This package owns one registered source definition:

- `x_oauth`, a credentialed remote source using the generic OAuth 2.0 PKCE capability.

The normalized post compiler stays at the package root rather than inside `oauth/`, so a second X
source could be added without moving it. The shared core classifies authored posts, filters replies and reposts, requires authored quote
commentary, selects the latest 25 eligible posts under the manifest's import cap, constructs
ordered media elements, and emits `candidate_bundle@1` with source VERIFY evidence. The capture
retains one provider page of up to 100 records; exclusions and the import cap apply before media
retrieval and candidate construction.

The source definition is activated only when its generic platform capabilities are complete, and
X import additionally requires provider configuration and an operator budget opt-in.
