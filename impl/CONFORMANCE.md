# Rhizome conformance status

The M1 store implements the rNet 0.1 CRUD surface, server-enforced grants, provenance validation, and revision-protected user writes.

Milestone-scheduled gaps:

- `POST /vibes/{id}/pull` becomes operational in M2.
- `POST /vibes/{id}/push` becomes operational in M3.
- M3 push tasks must preserve an existing `durable: true` inferred entry instead of overwriting it.
- Full ingest-record method conformance becomes reachable and enforced in M5; M1 accepts only the milestone's constant `parser` and `authored` stamps at creation.
- Production phone OTP and passkey authentication replace the development bearer identities in M7.
- Content-addressed payloads staged before a failed database transaction are unreachable but are not yet garbage-collected; reference-aware staged-payload collection ships with the background job infrastructure.
