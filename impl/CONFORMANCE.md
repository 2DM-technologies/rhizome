# Rhizome conformance status

M0 through M2 are complete. The store implements the rNet 0.1 CRUD surface, server-enforced
grants, provenance validation, last-write-wins user edits, internal revision history, and the
compiled ingestion/import milestone.

Implemented in M2:

- Deterministic file-backed and connected SimpleFIN `POST /vibes/{id}/pull` are operational in
  M2. SimpleFIN token exchange, encrypted owner-only credential storage, composite account
  selection, reviewed preview/confirm, fresh private OriginArtifacts on every fetch, and an
  immutable fetch history with commit-only VERIFY baselines are implemented. One-time claims are
  replay-safe, production credentials use per-record AWS KMS envelope encryption and a dedicated
  KMS HMAC keyring, local development keeps a private generated key file, and connected fetches
  have bounded deadlines, credential-wide provider limits, and revocation-safe leases. The live
  production KMS smoke test remains part of M8 productionizing.
- Source skills publish serializable manifests and resolve through separate file, credentialed,
  and public-remote executable catalogs. The host renders connection/source fields generically,
  secret fields never enter React state, source rows use free-form catalog-validated skill ids with
  connector/parser pins, and owner review recovery uses an opaque actor/Vibe/source/state-bound
  continuation instead of provider-specific protocol fields. Registration rejects source-kind or
  control/schema combinations the generic host cannot serialize; provider browser fixtures and
  adapters live beside their skills while the host suite exercises synthetic capabilities.
- Public Are.na v3 channel ingestion is operational. The supplied page URL is a validated channel
  locator; exact fixed-origin API pages and referenced assets are captured before deterministic
  parsing and VERIFY. Arbitrary public asset domains cross the DNS-pinned, redirect-revalidating,
  private-range-blocking SafePublicFetcher with credential stripping and resource limits. Reviewed
  candidates carry previewable staged MediaElements, confirmation atomically
  creates object-plus-element bundles and membership, cancellation creates no derived records,
  each imported Block starts with its canonical title as a `text/plain` element, and unchanged
  pulls deduplicate by block identity plus semantic fields, element roles, and element hashes. Vibe
  cards choose previews from generic media metadata and defer element/payload fetches until they are
  near the viewport.

Milestone-scheduled gaps:

- `POST /vibes/{id}/push` becomes operational in M3.
- M3 push tasks must preserve an existing `durable: true` inferred entry instead of overwriting it.
- Full ingest-record method conformance becomes reachable and enforced in M5; M1 accepts only the milestone's constant `parser` and `authored` stamps at creation.
- M2 credentialed-remote execution is transaction-specific: `CredentialedSourceSkill` requires the transaction parser, intermediate representation, and VERIFY pipeline, and the server always builds transaction candidates. Before installing a credentialed media or other non-transaction skill, M5 must split the generic credential lifecycle from a capability-dispatched parse, verify, and candidate pipeline; dispatch must use a platform capability kind, never a skill or provider ID.
- M2 installed credentialed skills execute inside the server process and load skill-owned settings from that process's environment, such as `RHIZOME_SIMPLEFIN_ALLOWED_HOSTS`. Before separately packaged skill discovery, M5 must introduce bounded deployment configuration keyed by skill ID and implementation pin and validated by each installed skill. Endpoint policy remains skill-owned and fail-closed.
- Production phone OTP and passkey authentication replace the development bearer identities in M7.
- Content-addressed payloads staged by a failed preview/transaction, or retained by a successful
  preview that is later canceled, expires, or is abandoned, are not yet garbage-collected. Operation
  results retain their manifests, but no reference-aware collector removes payloads that have no live
  MediaElement or unexpired preview reference; that collector ships with the M7 background job
  infrastructure.
- Import preview and pull jobs run in-process via `queueMicrotask` with no durable queue: a restart
  mid-run strands its operation in `queued` or `running`, no reaper reconciles it, and the host polls
  that state indefinitely. Durable background execution ships in M7 alongside the reference-aware
  staged-payload collection above.
