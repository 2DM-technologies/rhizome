# Rhizome conformance status

This file tracks deliberate gaps between the current implementation and the finalized rNet and
Rhizome architecture. Every open gap names the milestone that closes it; product detail and test
evidence belong in the [implementation plan](./IMPLEMENTATION_PLAN.md), concept documents, and test
suites.

## Implemented through M3

- The store implements the M1 store surface for origins, elements, MediaObjects, and Vibes, with
  server-enforced grants, provenance validation, last-write-wins user edits, and internal revision
  history.
- Every installed ingestion source compiles to the generic `candidate_bundle@1` contract before it
  reaches shared staging, review, and atomic confirmation. OFX and SimpleFIN remain independently
  registered sources under the transaction family, which owns their canonical transaction
  representation, shared VERIFY, and candidate compiler. Are.na and X compile their own media
  candidates through the same boundary.
- The host and server consume serializable source manifests and dispatch through generic capability
  and implementation/version pins rather than provider-specific branches. Source- and family-owned
  parsing and VERIFY and provider-specific capture and endpoint behavior remain quarantined with
  their skills, while generic enforcement remains platform-owned. Persisted execution limits are
  enforced by the server.
- X import uses the generic OAuth 2.0 Authorization Code with PKCE lifecycle. The skill captures one
  provider page into a versioned server-side capture archive, stores it as the OriginArtifact,
  re-reads it during parsing, and normalizes it into the shared X post representation before the
  shared eligibility, VERIFY, ordering, identity, text, and media compiler. The rNet `tweet`
  vocabulary and object-form element references (`{ uri, role?, alt? }`) are implemented across the
  schema, serializers, generated contracts, and host consumers.
- X import requires provider configuration and an explicit operator budget opt-in, because X has no
  meaningful free read tier and the removed archive-upload source was the only unpaid path. Without
  both, the source is absent from the installed catalog or reaches only the connection lifecycle, so
  a deployment can be conformant with no working X import. CI never depends on provider spend.
- Reviewed imports create no MediaObject, MediaElement, object-element link, Vibe membership, or
  pull-configuration entry before confirmation. Cancellation retains owner-only source and origin
  audit records, while confirmation commits the reviewed object-and-element bundle atomically.
- Push is an asynchronous, metered operation across elements, objects, and Vibes. Five installed
  tasks write only their own `rhizome:{task}` entry, preserve same-key durable entries, and keep
  other writers' entries intact under row locks. Each run has one cost row; owner-visible results
  report recorded usage while read grantees receive the same outcomes with usage omitted.
- Confirming an import that creates a new Vibe runs the installed tasks in element, object, and
  Vibe order after commit, using the same push operations and meters. Automatic imports retain the
  owner's transaction exclusion; keyless imports remain available. This sequence is in-process
  under the existing M7 durable-execution deferral.
- The host consumes generated task manifests, runs and polls push operations, renders inferred
  Vibe views, and refreshes every object or element named by a terminal result. The fake connector,
  provider boundary tests, and stubbed OpenAI tests make the full gate independent of provider spend.

## M5

- Define the `users.inferred` warm-start policy, including its writer and what client-invoked
  inference may read without leaking cross-Vibe information. M3 excludes this block from push
  context and writes.
- The schema conditionals already require `parser_hash` for `generated_parser` and prohibit
  reproducible `agent` records, but current execution and object-creation paths make only
  `parser`/reproducible and `authored`/non-reproducible stamps reachable. Add executable `agent` and
  `generated_parser` paths and accept their conformant ingest records.
- No committed CSV parser ships. “CSV” is a convention rather than a format, so a hand-written CSV
  skill is a registry of bank dialects that is never complete; file-based bank import is QFX/OFX-only
  until this path lands, and every CSV dialect reaches the store through it.

## M7

- Replace development bearer identities with Better Auth phone OTP and first-session passkey
  enrollment. Live Twilio Verify provisioning remains part of M8.
- Expose the retained object revision history through history and revert behavior.
- Move import preview and pull work from in-process `queueMicrotask` jobs to durable execution. Add
  a reaper that reconciles work interrupted while `queued` or `running`, and stop host polling when a
  job can no longer make progress.
- Push runs in the API process like preview and pull (`impl/concepts/push-pipeline.md` §6.4a). Until
  durable execution: a restart fails every `queued` or `running` operation at the next boot,
  rejecting their open source fetches, instead of resuming it; a push's writes are not guarded
  against `user` edits or membership changes between assembly and write; a stranded run's late
  writes are not fenced, since a run cannot be stranded while its process is alive; and a provider
  call in flight when the process dies is not metered.
- Add reference-aware garbage collection for unreferenced staged capture/origin and element bytes
  left by failed, canceled, or abandoned previews. Preserve bytes referenced by live
  OriginArtifacts, MediaElements, or retained preview manifests.
- Generic material is stored inside its first consumer, so the next consumer must either duplicate it
  or import across a package boundary the quarantine rules otherwise forbid. Two instances exist
  today. `apps/ingest/skills/x/zip.ts` is a general bounded capture-archive reader — traversal,
  entry-count, and byte guards — that lives in the X package only because X was the first source to
  store a zip capture; Pinterest’s planned server-side capture archive would have to import from
  another provider’s package or copy it. Separately, every skill’s E2E suite imports the host
  application’s test harness from `apps/host/e2e/support/` for the Playwright fixture, mock store,
  and shared reviewed-file conformance driver, so no skill package can be exercised without reaching
  into another app. Move both behind shared, skill-facing modules before alpha: a skill package must
  import the platform, never another skill package or the host.

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
- Define file refresh and reselection semantics for replacing the origin bytes bound to an existing
  file source.

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
