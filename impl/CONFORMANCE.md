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
- Public Are.na v3 channel ingestion is operational. Public channel URLs become allowlisted remote
  sources; exact API pages and approved assets are captured before deterministic parsing and
  VERIFY. Reviewed candidates carry previewable staged MediaElements, confirmation atomically
  creates object-plus-element bundles and membership, cancellation creates no derived records,
  each imported Block starts with its canonical title as a `text/plain` element, and unchanged
  pulls deduplicate by block identity plus semantic fields, element roles, and element hashes.

Milestone-scheduled gaps:

- `POST /vibes/{id}/push` becomes operational in M3.
- M3 push tasks must preserve an existing `durable: true` inferred entry instead of overwriting it.
- Full ingest-record method conformance becomes reachable and enforced in M5; M1 accepts only the milestone's constant `parser` and `authored` stamps at creation.
- Production phone OTP and passkey authentication replace the development bearer identities in M7.
- Content-addressed payloads staged before a failed database transaction are unreachable but are not yet garbage-collected; reference-aware staged-payload collection ships with the background job infrastructure.
