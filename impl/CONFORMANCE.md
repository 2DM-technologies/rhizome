# Rhizome conformance status

The M1 store implements the rNet 0.1 CRUD surface, server-enforced grants, provenance validation, last-write-wins user edits, and internal revision history.

Milestone-scheduled gaps:

- `POST /vibes/{id}/pull` becomes operational in M2.
- `POST /vibes/{id}/push` becomes operational in M3.
- M3 push tasks must preserve an existing `durable: true` inferred entry instead of overwriting it.
- Full ingest-record method conformance becomes reachable and enforced in M5; M1 accepts only the milestone's constant `parser` and `authored` stamps at creation.
- M2 credentialed-remote execution is transaction-specific: `CredentialedSourceSkill` requires the transaction parser, intermediate representation, and VERIFY pipeline, and the server always builds transaction candidates. Before installing a credentialed media or other non-transaction skill, M5 must split the generic credential lifecycle from a capability-dispatched parse, verify, and candidate pipeline; dispatch must use a platform capability kind, never a skill or provider ID.
- M2 installed credentialed skills execute inside the server process and load skill-owned settings from that process's environment, such as `RHIZOME_SIMPLEFIN_ALLOWED_HOSTS`. Before separately packaged skill discovery, M5 must introduce bounded deployment configuration keyed by skill ID and implementation pin and validated by each installed skill. Endpoint policy remains skill-owned and fail-closed.
- Production phone OTP and passkey authentication replace the development bearer identities in M7.
- Content-addressed payloads staged before a failed database transaction are unreachable but are not yet garbage-collected; reference-aware staged-payload collection ships with the background job infrastructure.
