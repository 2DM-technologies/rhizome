# Rhizome conformance status

This file tracks deliberate gaps between the current implementation and the finalized rNet and
Rhizome architecture. Every open gap names the milestone that closes it; product detail and test
evidence belong in the [implementation plan](./IMPLEMENTATION_PLAN.md), concept documents, and test
suites.

## Implemented through M2

- The store implements the M1 store surface for origins, elements, MediaObjects, and Vibes, with
  server-enforced grants, provenance validation, last-write-wins user edits, and internal revision
  history.
- Every installed ingestion source compiles to the generic `candidate_bundle@1` contract before it
  reaches shared staging, review, and atomic confirmation. CSV, OFX, and SimpleFIN remain
  independently registered sources under the transaction family, which owns their canonical
  transaction representation, shared VERIFY, and candidate compiler. Are.na and both X sources
  compile their own media candidates through the same boundary.
- The host and server consume serializable source manifests and dispatch through generic capability
  and implementation/version pins rather than provider-specific branches. Source- and family-owned
  parsing and VERIFY, provider-specific capture and endpoint behavior, and browser workers remain
  quarantined with their skills, while generic enforcement remains platform-owned. Persisted
  execution limits are enforced independently by the browser and server where applicable.
- X archive import uses an allowlisted, version-pinned browser preprocessor, while X account import
  uses the generic OAuth 2.0 Authorization Code with PKCE lifecycle. Each normalizes its provider
  input into the shared X post representation; both then use the shared eligibility, VERIFY,
  ordering, identity, text, and media compiler. The rNet `tweet` vocabulary and object-form element
  references (`{ uri, role?, alt? }`) are implemented across the schema, serializers, generated
  contracts, and host consumers.
- Reviewed imports create no MediaObject, MediaElement, object-element link, Vibe membership, or
  pull-configuration entry before confirmation. Cancellation retains owner-only source and origin
  audit records, while confirmation commits the reviewed object-and-element bundle atomically.

## M3

- Make `POST /vibes/{id}/push` operational while preserving any existing `durable: true` inferred
  entry instead of overwriting it.

## M5

- The schema conditionals already require `parser_hash` for `generated_parser` and prohibit
  reproducible `agent` records, but current execution and object-creation paths make only
  `parser`/reproducible and `authored`/non-reproducible stamps reachable. Add executable `agent` and
  `generated_parser` paths and accept their conformant ingest records.

## M7

- Replace development bearer identities with Better Auth phone OTP and first-session passkey
  enrollment. Live Twilio Verify provisioning remains part of M8.
- Expose the retained object revision history through history and revert behavior.
- Move import preview and pull work from in-process `queueMicrotask` jobs to durable execution. Add
  a reaper that reconciles work interrupted while `queued` or `running`, and stop host polling when a
  job can no longer make progress.
- Add reference-aware garbage collection for unreferenced staged capture/origin and element bytes
  left by failed, canceled, or abandoned previews. Preserve bytes referenced by live
  OriginArtifacts, MediaElements, or retained preview manifests.

### M7 conditional follow-ups

These become required only when the associated source or product scope expands:

- Source definitions are currently installed through compile-time lists, server-side skill code
  runs in the API process, and settings load from that process's environment. Before independently
  packaged skills are enabled, add stronger package/runtime isolation behind a generic, fail-closed
  boundary. Provider endpoint policy must remain source-owned.
- Host payload presentation resolves by prefix-matching MIME with a terminal `download`
  fallback, so an element kind or media type the host cannot render silently degrades to a file
  chip instead of reporting that it is unsupported. Before adding element kinds or media types
  beyond the currently rendered set, replace this with an explicit capability registry and a
  distinct unsupported state.
- Before substantially increasing X archive limits, add the required resumable upload,
  complete-archive retention, range-backed access, paginated review, and durable large-job support.
- Define file refresh and reselection semantics for replacing a compact capture on the same logical
  source.
- X MediaObject identity deduplication is currently source-scoped. Define cross-source
  reconciliation for the same stable X post imported through archive and OAuth.

## M8

- Provision Twilio Verify with live production credentials, Fraud Guard, send limits, launch
  geo-fencing, and production smoke coverage for the M7 authentication path.
- Move arbitrary public asset fetching out of the API process and behind a separately deployed,
  least-privilege egress worker with no database or provider credentials and no route to database,
  loopback, link-local, private, or special networks. Production smoke tests must prove allowed,
  bounded HTTPS/443 fetches succeed while denied destinations remain unreachable and the API has no
  direct arbitrary-domain fetch path.
- Provision and exercise the production KMS envelope-encryption and HMAC keyring path, including
  live seal/open/fingerprint tests and credential-rotation drills. Run the deferred live X-provider
  smoke tests and establish provider-budget operations without making paid-provider access a CI
  dependency.
