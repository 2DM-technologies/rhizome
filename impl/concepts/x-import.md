# X import

**Status:** M2 implementation plan, revised after M2 to remove the X archive source and the
browser file-capture preprocessor. No implementation is included in this document.

**Companion docs:** [M2 implementation plan](../IMPLEMENTATION_PLAN.md), [sandboxing](./sandboxing.md), and [design tiers](./design-tiers.md).

## 1. Purpose

X is the final M2 abstraction test: a second media-oriented domain and a credentialed source using OAuth. The implementation must prove that a new source can be added without teaching the host or server about that provider.

OAuth is the only X ingestion path. An archive-upload source was built during M2 and then removed. Requesting an X data export, waiting hours or days for the email, and uploading a multi-gigabyte ZIP is the opposite of the three-minute stranger test, and the browser preprocessor it needed generalized a capability from exactly one caller. Removing it makes live provider access the precondition for X import, because X has no meaningful free read tier: X import ships only where provider configuration and budget exist, and CI still never depends on provider spend.

The initial product promise is deliberately bounded:

- Import up to the 100 most recent eligible posts from the connected account.
- Support original posts and quote posts with authored commentary.
- Exclude replies and bare reposts.
- Preserve text and supported image/video attachments as MediaElements.
- Create a new Vibe, defaulting to `@handle Tweets` and falling back to `Tweets`.

The UI must say “up to 100 most recent eligible posts,” not “all posts.”

## 2. Architectural invariant: compile every source to candidate bundles

The common ingestion pipeline becomes:

```text
capture -> source parser -> source VERIFY -> candidate_bundle@1
        -> generic staging -> generic review -> generic confirm
```

Every parser ultimately emits a generic `SourceCandidateDraft` bundle. A transaction is one kind of MediaObject candidate, normally with no elements; it is not a separate server pipeline.

The migration has these rules:

1. Move the current public candidate and element drafts into a shared ingestion contract and remove the `Public` prefix.
2. Adapt OFX and SimpleFIN transaction output to candidate bundles after transaction-specific parsing and VERIFY.
3. Have Are.na and X emit candidate bundles directly.
4. Make the server dispatch on the registered capability kind `candidate_bundle@1`, never on a provider or skill ID.
5. Remove server knowledge of `ParsedTransactions`, transaction VERIFY, and transaction MediaObject construction.
6. Preserve the current OFX, SimpleFIN, and Are.na behavior and tests exactly during this migration.

The source skill owns capture interpretation, parsing, source-specific VERIFY, semantic identity, and compilation. The platform owns artifact storage, lifecycle, generic limits, staging, review, confirmation, authorization, and operation reporting.

### Transaction skill family

The same compiled-source boundary implies that OFX and SimpleFIN should be organized as source definitions within one transaction-domain skill family:

```text
apps/ingest/skills/transactions/
  SKILL.md
  BOUNDARIES.md
  VERIFY.md
  definition.ts
  contracts.ts
  transaction-candidates.ts
  verify.ts
  verify.test.ts
  ofx/
    SKILL.md, BOUNDARIES.md, VERIFY.md
    manifest.ts
    parser.ts
    source.ts
    ofx.test.ts
    fixtures/
    e2e/
  simplefin/
    SKILL.md, BOUNDARIES.md, VERIFY.md
    manifest.ts
    definition.ts
    config.ts
    contracts.ts
    client.ts
    parser.ts
    source.ts
    simplefin.test.ts
    fixtures/
    e2e/
```

Each child owns its own boundary docs, fixtures, and E2E suite; the family root holds only the shared representation, VERIFY, and compiler.

`transactions` is a code-owning domain package, not a user-selectable source. OFX and SimpleFIN remain independently registered source definitions with their own source IDs, labels, source kinds, manifests, capture mechanisms, and parser versions.

The family root owns the canonical transaction intermediate representation, shared transaction VERIFY rules, and the transaction-to-candidate-bundle compiler. Each child owns only its format- or provider-specific capture and parsing behavior:

- OFX is a file source definition that parses into the canonical transaction representation.
- SimpleFIN is a credentialed remote source definition whose claim exchange, connector, capture, and provider protocol remain quarantined under `transactions/simplefin/`.
- Both pass the canonical representation through shared transaction VERIFY and compile to `candidate_bundle@1` before reaching the server.

This organization does not make the server aware of a transaction skill family; the runtime catalog still exposes two generic source definitions. It also does not move the canonical rNet transaction schema into application skill code. No committed CSV source exists: “CSV” is a convention rather than a format, so a hand-written CSV parser is really a registry of bank dialects that is never complete, and every dialect belongs to the M5 `generated_parser` path. A future general-purpose tabular-data importer would be a separate skill regardless.

## 3. One X package, one source definition

All executable X behavior lives together:

```text
apps/ingest/skills/x/
  SKILL.md
  BOUNDARIES.md
  VERIFY.md
  definition.ts
  contracts.ts
  tweet-candidates.ts
  tweet-candidates.test.ts
  entities.ts
  entities.test.ts
  verify.ts
  zip.ts
  quarantine.test.ts
  fixtures/
  oauth/
    manifest.ts
    config.ts
    oauth.ts
    client.ts
    capture.ts
    parser.ts
    source.ts
    parser.test.ts
    protocol.test.ts
    registration.test.ts
    source.test.ts
    e2e/
```

Post eligibility, normalization, entity handling, and VERIFY are shared at the package root rather than duplicated per source, so `verify.ts` is a single family-level module rather than one file per source definition.

The package registers one source definition:

- `x_oauth`: credentialed remote source and the only X ingestion path.

Post eligibility, normalization, element construction, ordering, limits, and VERIFY rules stay at the package root in `tweet-candidates.ts` rather than inside `oauth/`, so a second X source could be added without moving them. `zip.ts` reads the capture archive the source itself writes; it is generic enough to belong to the platform rather than this package, and that misplacement is recorded as a pre-alpha item in [CONFORMANCE.md](../CONFORMANCE.md). Outside this package, the only X-specific material allowed is generated/catalog registration, the rNet `tweet` vocabulary, generic schema migrations, tests enforcing quarantine, and documentation.

The host must not import X TypeScript or branch on an X source ID. It renders the source manifest and generic review model. There is no X-specific renderer; the generic text, image, video, and document renderers display the result.

## 4. The rNet `tweet` MediaObject type

Add `schemas/0.1/types/tweet.json` to rNet and register it with the existing code generation, validators, fixtures, tests, and specification. M2 is still building the unfinished `0.1` draft, so this does not require an rNet version bump.

A tweet candidate has:

- `type: "tweet"`.
- Stable keys including `x_tweet_id`, `x_author_id`, and the canonical post URL.
- Source facts for publication time, author handle/name, post kind, conversation and referenced-post IDs, language, sensitivity/edit metadata, and structured entities.
- The exact post text as the first `text/plain` MediaElement.
- Image and video MediaElements in source order after the text element.

Post text must not also be duplicated into source properties. URL entities may be captured as structured facts, but the text payload remains the exact UTF-8 source text; the importer does not rewrite or expand `t.co` text.

Quote targets remain inert identifiers/URLs in keys or source properties. This milestone does not introduce a general MediaObject relationship system.

Volatile engagement metrics do not participate in semantic identity. The generic compiled-source contract exposes a semantic-identity hook so the X skill, rather than the server, decides which source fields describe the stable object.

## 5. MediaObject element references

Supporting meaningful ordered post elements requires changing the rNet schema as well as Rhizome. The current string-only element reference is replaced in place with an object:

```ts
interface MediaObjectElementRef {
  uri: string;
  role?: "title" | "content" | "preview";
  alt?: string;
}
```

The decisions are:

- `uri` is required.
- `role` is optional because some associations, including a generic user upload, are genuinely ambiguous. Producers must not guess.
- `alt` is optional and belongs to the association, not the byte object, because identical bytes can have different descriptions in different uses.
- The database columns corresponding to role and alt text are nullable.
- `media-element.json` itself does not change.

Because the only existing state is disposable local development state, the schema changes directly to object references. Do not introduce a `string | object` union, a legacy decoder, a compatibility migration, or other code solely to preserve the current local string representation. Reset and reseed local state instead.

Update rNet schemas, generated types, validators, fixtures, tests, and specification together with Rhizome persistence, serializers, routes, consumers, and current producers. Are.na and X set roles and alt text when known; ambiguous user uploads omit them.

## 6. Eligibility, ordering, and identity

An eligible X post is one of:

- An original post authored by the connected account owner.
- A quote post authored by that user with meaningful authored commentary.

Exclude:

- Replies.
- Bare reposts.
- Quote posts that contain only the provider-added quoted-post URL and no authored commentary.

Quote eligibility is determined by removing only the provider-identified quoted-post URL span for the purpose of the test, then checking whether meaningful authored text remains. The stored text element still contains the exact original source text.

After classification, sort eligible posts deterministically newest-first, use the stable post ID as the tie-breaker, and select the first 100. The cap applies after exclusions.

VERIFY reports at least:

- Total source post records examined.
- Replies excluded.
- Bare reposts excluded.
- Quotes without commentary excluded.
- Eligible count.
- Imported count and configured cap.
- Missing or omitted media, grouped by deterministic reason.

Within one source, the stable X post ID provides idempotency. Stable X keys are retained so that a second X source, were one ever added, could support a cross-source reconciliation policy without re-deriving identity.

## 7. Generic, persisted execution limits

Limits are a platform contract, not literals inside the X parser or host:

```ts
interface SourceExecutionLimits {
  maxCandidates: number;
  maxCaptureBytes: number;
  maxElementBytes: number;
  maxTotalElementBytes: number;
}
```

Initial X limits are:

- `maxCandidates: 100`
- `maxCaptureBytes: 48 MiB`
- `maxElementBytes: 25 MiB`
- `maxTotalElementBytes: 40 MiB`

All element bytes, including text, count toward the total. The installed source definition supplies defaults; the effective values are persisted with the source/capture, exposed through the manifest, passed to compilation, and enforced by the server. This makes a later default change auditable.

The 100-post cap is not a configuration value, and raising it is a code change rather than a setting. The provider request is fixed at a single `max_results=100` page, the capture manifest records `maxResults: 100` as request evidence, and replay rejects a capture whose `maxCandidates` exceeds 100. Going to 500 therefore requires provider pagination, relaxed timeline and parser validation, and a new capture format version. Below that ceiling the retained capture is authoritative rather than stale: the stored archive holds the complete returned page, so a cap lowered and then restored under 100 re-reads what was retained instead of refetching.

## 8. Text, images, video, and deterministic omissions

Every imported post contains its text element, including posts with media.

Photos become image elements in source order. When X provides attachment alt text, it is stored on that post-to-element association.

Video is supported within the same generic byte limits:

- Import accepts a direct HTTPS MP4 variant.
- M2 does not assemble HLS segments, transcode, or convert media.

Attachment processing is deterministic:

1. Visit attachments in source order.
2. Omit an attachment larger than 25 MiB.
3. Omit an attachment if adding it would exceed the 40 MiB aggregate element budget.
4. Continue checking later, smaller attachments rather than stopping at the first omission.
5. Record every omission and reason in source facts and VERIFY; never silently drop media.

Unsupported media formats follow the same declared-omission path rather than rejecting an otherwise valid text post.

## 9. Generic connection modes

Source manifests describe connection behavior through generic modes:

```ts
type ConnectionManifest =
  | {
      mode: "claim_exchange";
      claim_policy: { kind: "single_use_global" };
    }
  | {
      mode: "oauth2_pkce";
      button_label: string;
    };
```

`claim_exchange` describes the SimpleFIN-style flow: the manifest renders a setup-claim field, the skill canonicalizes a replay key, the server enforces successful global single use, the skill exchanges the claim, and only the resulting durable secret is sealed. It is not the mode for a reusable API key; a future reusable static secret would get its own mode.

Do not add skill-level `attempts` or `window_hours` policy. Generic server-owned abuse protection may still throttle connection endpoints operationally, but the source manifest exposes only the single-use policy that the product currently supports.

`oauth2_pkce` is a connection mode rather than a form control. The manifest produces a “Sign in with X” action that starts a pending connection attempt, redirects to the provider, handles the callback, seals the resulting credential, and resumes the intended import.

The generic OAuth platform must:

- Generate high-entropy state and PKCE verifier/challenge values.
- Persist only a state hash plus an encrypted verifier in a durable `source_connection_attempts` record.
- Bind the attempt to owner, skill, connector version, import intent, exact callback, and a server-approved return target.
- Enforce expiry, one-time consumption, and explicit terminal status.
- Exchange credentials only on the server.
- Keep authorization codes, access tokens, and refresh tokens out of browser storage, URLs after callback handling, logs, operation payloads, and client-visible errors.
- Seal durable tokens with the existing source-credential boundary.
- Refresh under a per-credential lease and atomically reseal any returned token set.
- Support generic disconnect/revocation lifecycle while leaving provider endpoints and error interpretation to the skill.

For X, request only `tweet.read`, `users.read`, and `offline.access`. The X skill owns authorization/token endpoints, `/users/me`, timeline capture, refresh/revoke behavior, response parsing, and provider-error mapping.

## 10. X OAuth capture

OAuth is the only X ingestion path. Its acceptance target is:

- The generic PKCE connection lifecycle has synthetic conformance coverage.
- X can connect an identity with `/users/me` and store sealed credentials.
- When an operator enables provider access and budget, the X timeline capture fetches at most one 100-result page because the product cap is 100.
- The returned records compile through the shared X normalizer and candidate-bundle path.
- Live provider spend is never required by CI.

The timeline request excludes replies and reposts at the provider when supported, but the parser repeats eligibility checks. It requests only the fields and expansions required for identity, text, authorship, references, order, and selected media. A generic cost review action may be required before the first paid remote capture.

Later pulls checkpoint the newest seen post ID and include a small edit-overlap policy. Absence from a later timeline response is not evidence of deletion.

`/users/me` verifies account identity; it is not turned into a synthetic post. If the account has zero eligible posts, zero candidates is a valid, honest result.

## 11. Generic host and destination behavior

The host reads only source manifests and generic ingestion state. It must be able to:

- Present X OAuth as a connection mode without a provider branch.
- Invoke an advertised connection mode without provider branches.
- Show the effective candidate and byte limits before capture.
- Render generic candidate text/media and VERIFY results.
- Display generic required-action/continuation envelopes when review or reconnection is needed.
- Confirm candidates into a new Vibe without constructing X-specific payloads.

The destination Vibe should be staged and created on confirmation so cancellation does not leave an empty Vibe. The default title is `@handle Tweets`, falling back to `Tweets` when no handle is available.

## 12. Test strategy and quarantine

### Generic platform coverage

- Candidate-bundle contract and conformance tests.
- Regression coverage proving OFX, SimpleFIN, and Are.na behavior is unchanged.
- A synthetic OAuth source covering PKCE, state replay, expiry, actor binding, callback binding, open-redirect prevention, token leakage, refresh serialization, and disconnect.
- A generic host E2E driven by synthetic manifests rather than an X-named host test.

### rNet coverage

- `tweet` schema validation and generated-type tests.
- Object-only `MediaObjectElementRef` validation.
- Optional role and alt behavior.
- Ordered element reference serialization.

### X OAuth coverage

- Mocked `/users/me`, timeline, media, token, refresh, revoke, provider error, and rate-limit responses.
- Requested scopes and exact callback behavior.
- 100-result product cap and eligibility revalidation.
- Capture-archive traversal, duplicate/case-conflicting entry, ZIP-bomb, and malformed JSON rejection on re-read.
- Original/quote/reply/repost classification, including quote commentary edge cases.
- Newest-first selection after filtering and stable tie-breaking.
- Exact text preservation, media ordering, alt association, hashes, video handling, and deterministic omission reports.
- Server-side enforcement of candidate, capture, per-element, and aggregate limits.

The X package owns its parser and connector E2E tests. A quarantine test prevents X/Twitter endpoints, scopes, response-field branches, environment names, or source IDs from leaking outside `apps/ingest/skills/x`. The lint must allow the rNet `tweet` vocabulary, generated registration, generic migrations, and docs; a raw repository-wide ban on the word “tweet” would be too broad.

## 13. Implementation sequence

1. **Generic candidate bundles and transaction family:** introduce `candidate_bundle@1`; consolidate OFX and SimpleFIN under `skills/transactions/`; adapt them through the shared transaction compiler; and preserve their behavior.
2. **rNet media model:** add `tweet` and replace string element refs with object refs whose role/alt are optional.
3. **Generic limits:** persist `SourceExecutionLimits`.
4. **X shared core:** add package boundaries, manifests, common contracts, post eligibility, normalization, VERIFY, and fixtures.
5. **Generic OAuth:** add durable PKCE connection attempts and synthetic conformance coverage.
6. **X OAuth:** add identity, budgeted timeline capture, media retrieval, refresh/revoke behavior, and mocked E2E.
7. **Hardening:** complete quarantine, regression, documentation, operation/redaction, and conformance checks.

Steps 1 and 2 may be developed in parallel, but both must land before X candidate persistence.

## 14. Deferred production/conformance work

Record these as explicit follow-ups rather than quietly baking temporary assumptions into provider code:

- File-source refresh/reselection semantics for replacing the origin bytes bound to an existing file source.
- Stronger runtime/package isolation when installed skills move out of the main server process or codebase.
- Public asset fetch isolation from database/private networking.
- Production KMS and X-provider smoke tests, credential rotation drills, and provider-budget operations.
- Staged capture/payload garbage collection.

## 15. Definition of done

M2 X import is complete when:

- A connected X account imports up to 100 eligible posts into a new Vibe with deterministic ordering.
- Text is stored once as the first MediaElement; supported images/video follow with association-level alt text where supplied.
- Replies and bare reposts are excluded, and quote posts require authored commentary.
- VERIFY explains every selection and media omission count.
- Existing sources pass unchanged through the generic candidate-bundle pipeline.
- OFX and SimpleFIN are independently registered sources under the transaction skill family, with no transaction- or SimpleFIN-specific server behavior.
- rNet and Rhizome use object-only element references with optional role/alt fields.
- The host and server contain no X-specific behavioral branches.
- Generic OAuth PKCE conformance passes, and the X adapter can connect an identity and exercise mocked capture without requiring provider spend in CI.
- Limits are manifest-driven, persisted, and enforced by the server.
- X quarantine, security, parser, integration, and E2E suites are green without large generated snapshots.

## 16. Provider references

- [OAuth 2.0 Authorization Code Flow with PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)
- [OAuth 2.0 user access token integration](https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token)
- [User Posts timeline integration](https://docs.x.com/x-api/posts/timelines/integrate)
