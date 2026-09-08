# Pinterest import

**Status:** Proposed M2 implementation plan. No implementation is included in this document.

**Companion docs:** [M2 implementation plan](../IMPLEMENTATION_PLAN.md), [X import](./x-import.md), [sandboxing](./sandboxing.md), and [design tiers](./design-tiers.md).

## 1. Why Pinterest

A Pinterest board is already a human-curated collection of media. It does not need to be reinterpreted as a vibe — it *is* one. X gives you a person's authored output and asks Rhizome to treat a timeline as a vibe; Pinterest gives you the curation directly. For a protocol whose thesis is "media curated by users," this is the most on-thesis source in the catalog.

It also exercises a part of the abstraction nothing else has. X imports a timeline: connect, get the last 100 things. Pinterest imports a *user-selected scope* — a specific board. That combination, OAuth plus caller-chosen source configuration, has never been tested. §5 shows the platform already supports it.

The binding constraint on any consumer import source is whether an ordinary user can connect without first changing something about their account. §2 evaluates Pinterest against that bar and finds one open question worth settling before anything else is built.

Scope, bounded:

- Connect a Pinterest account and import the pins from one user-selected board.
- Up to 200 pins, matching the Are.na channel cap rather than the X timeline cap of 100.
- Preserve pin title, description, and image media as MediaElements.
- Create a new Vibe defaulting to the board's own name.

## 2. Provider suitability

| Criterion | Pinterest |
| --- | --- |
| Personal end-user accounts | **Unresolved — needs a 20-minute test (§16 S1).** The documented requirement is developer-side only |
| Developer account type | Business account required to own the app — a one-time operator task, not a per-user gate |
| PKCE | Not documented; confidential client using HTTP Basic |
| Access token life | 30 days |
| Refresh token life | 60 days, **refreshable indefinitely** for apps created on or after 25 September 2025 |
| Refresh preconditions | None — an ordinary refresh-token grant |
| App review | Required for Standard access; **Trial access may suffice for alpha** (§13) |
| Revocation endpoint | Present |

The one genuinely open question is the first row. Pinterest's documentation states that *developers* must own their app under a business account, and is silent on the account type of the connecting end user. The available evidence is indirect and points toward personal accounts working with reduced scope: Pinterest describes granted permissions as mirroring "the account permissions of the currently logged-in user," which is a spectrum rather than a gate, and the scopes Rhizome needs — `boards:read`, `pins:read`, `user_accounts:read` — are the least privileged in the set. The scopes plausibly restricted to business accounts are analytics and ads, and Rhizome needs neither.

**Do not build on that inference. Test it first (§16 S1).** It is roughly twenty minutes of work and it decides whether Pinterest is the right provider at all, which makes it worth doing before any code is written.

## 3. The platform mandates PKCE and Pinterest cannot satisfy it

[`source-connection-service.ts`](../../apps/server/src/services/source-connection-service.ts) validates every adapter-produced authorization URL:

```ts
!exactSearchParameter(url, "code_challenge", input.codeChallenge) ||
!exactSearchParameter(url, "code_challenge_method", "S256") ||
```

An adapter that omits the challenge throws `OAuth source produced an unsafe authorization URL`. Pinterest authenticates at the token endpoint with HTTP Basic `client_id:client_secret` and does not document PKCE, so an honest Pinterest adapter cannot satisfy this validator.

The platform generalized from a single provider. X is a public client that uses PKCE, and its shape became the contract for all OAuth sources. Pinterest — a confidential client without PKCE — is the ordinary case in the wider OAuth world, and the platform has no way to express it.

The tempting workaround is to send a `code_challenge` Pinterest will ignore. Reject it: the platform would then assert PKCE protection it does not have, with no way for a reader to tell which providers actually verify the challenge. That is a false generalization baked into the contract.

**The change:**

- Rename the manifest mode `oauth2_pkce` → `oauth2`. The host reads this only to decide whether to render a sign-in button; PKCE is a server↔skill detail that leaked into a client-facing contract.
- Add a required field to the connection definition:

  ```ts
  readonly pkce: "S256" | "none";
  ```

  Required, not defaulted — matching the house rule that made `secret` required on input fields so a new skill cannot inherit an unsafe default.
- `validatedAuthorizationUrl` enforces `code_challenge` + `code_challenge_method=S256` **when and only when** the adapter declares `S256`, and **forbids** either parameter when the adapter declares `none`. A typo cannot silently degrade into security theater in either direction.
- The verifier is still generated and sealed for every attempt. The `verifier` column stays `notNull` and **no migration is required**.
- **Invariant to test:** the verifier is never passed to an adapter declaring `pkce: "none"`. Model `exchange()`'s input as a union discriminated on `pkce` so the compiler enforces it, rather than trusting an adapter to ignore a server-only secret it was handed.

Rename cost is mechanical and known: **30 occurrences across 17 files** as of `db3357c`, concentrated in `ImportPanel.tsx` (6), `connected-sources/types.ts` (3), and `e2e/support/mockStore.ts` (3). The mode string now appears as a `const` literal in `oauth2PkceConnectionManifestSchema` rather than a shared `SOURCE_CONNECTION_MODES` array, which `8d3b37b` removed.

Because `pkce: "none"` forgoes proof-of-possession, the compensating controls must be stated in `BOUNDARIES.md` and covered by tests: HTTPS-only authorization URL, exact registered callback, one-time state consumption, browser-binding cookie, 10-minute attempt TTL, and a mandatory client secret at the token endpoint.

## 4. Provider facts

**Verified in research:**

| Purpose | Endpoint |
| --- | --- |
| Authorize | `https://www.pinterest.com/oauth/` |
| Token / refresh | `https://api.pinterest.com/v5/oauth/token` |

- **Client authentication:** HTTP Basic, `client_id:client_secret` base64-encoded. Confidential client; the secret is mandatory.
- **Scopes needed:** `user_accounts:read`, `boards:read`, `pins:read`. Add `boards:read_secret` / `pins:read_secret` only if secret boards are in scope — §10 argues they should not be, initially.
- **Token lifetimes:** access token 30 days; refresh token 60 days, refreshable indefinitely ("continuous refresh") for apps created on or after 25 September 2025. A new app gets the good path automatically.
- **Access tiers:** Trial and Standard. Standard requires app review including a demo video that shows the authentication flow.

**Not verified — the API reference is behind a JS-rendered SPA that would not load. Treat as spike items (§16), not as facts:** exact board and pin field names, the `account_type` enum values, pagination parameters and page-size ceilings, and video-pin media shape.

## 5. Board selection: no new platform capability needed

Pinterest needs the user to choose *which* board. The instinct is a dynamic dropdown populated after connection — which the platform does not support, since `input_fields` carries only a static `options` array.

It does not need one. **Are.na already established the precedent:** a `target: "source"` input field of control `url`, into which the user pastes a public channel URL, which the skill resolves through the API. Pinterest follows it exactly — the user pastes a board URL (`https://www.pinterest.com/{username}/{board-slug}/`) and the skill resolves it to a board id using the connected credential.

Critically, this combination is **already legal today**. `assertConnectionManifestCoverage` rejects an OAuth skill that declares `target: "connection"` input fields, but places no restriction on `target: "source"` fields. X's OAuth manifest simply declares `input_fields: []` because a timeline needs no configuration. Pinterest declaring a source-target board URL field requires no contract change, and proves the OAuth-plus-configuration path the catalog was designed for but never exercised.

A dynamic board picker — a generic "connected-source option discovery" capability that would also serve Spotify playlists and YouTube playlists — is a legitimate future capability and belongs in §18, not here.

## 6. Curation, not authorship

Pinterest differs from X in a way that reaches the data model: **most pins on a user's board were not created by that user.** A board is a curation of other people's images.

This is not a problem, and Are.na already settled the precedent — an Are.na channel is the same situation, and the existing importer handles it. The rules carry over:

- The rNet `owner` of every imported MediaElement is the Rhizome user. They own the record, not the original work.
- Original provenance is preserved as source facts, never discarded: the pin's outbound `link`, the source domain, and the pin's own canonical URL.
- Pins the connected user did author are distinguishable and worth recording as a fact rather than a separate type.

It is also the reason Pinterest is the most on-thesis source available. X measures what a person *published*; a Pinterest board measures what they *chose to keep*, which is a considerably purer curation signal for vibe-based computing.

## 7. Credential model

The sealed token set mirrors `rhizome.x-oauth-token-set@1`:

```
format: rhizome.pinterest-oauth-token-set@1
access_token          30-day token
refresh_token         60-day token, continuously refreshable
expires_at_epoch      stamped at exchange
refresh_expires_at_epoch
scope                 exactly the granted read scopes
account               { id, username, account_type }
```

Refresh is an ordinary refresh-token grant with no age precondition or permanent-expiry cliff, so the platform's existing lazy refresh under the per-credential lease is **correct as-is** and needs no new machinery. The 60-day refresh window is renewed on every use, and continuous refresh means an active user never has to reconnect.

`exchange()` performs authorization-code → token, then `GET /v5/user_account` for identity. `publicMetadata` carries `account_id`, `account_username`, `account_type`.

Pinterest exposes a revocation endpoint, so `revoke` is implemented rather than omitted, and the orphan-cleanup path in `complete()` — which best-effort revokes a token whose credential commit failed — works properly.

## 8. Package layout

```
apps/ingest/skills/pinterest/
  SKILL.md
  BOUNDARIES.md
  VERIFY.md
  definition.ts
  contracts.ts
  pin-candidates.ts
  verify.ts
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
    e2e/
```

One registered source definition: `pinterest_board`. The name states the scope honestly — this imports a board, not an account.

## 9. The rNet `pin` type

Add `schemas/0.1/types/pin.json`, modeled on `tweet.json` and registered with the existing code generation, validators, fixtures, tests, and specification. `0.1` is still an unfinished draft, so no version bump is required.

- `type: "pin"`.
- Stable keys: `pinterest_pin_id`, `pinterest_board_id`, and the canonical pin URL.
- Required source properties: `created_at`.
- Optional: `board_name`, `pinner_username`, `link` (the pin's outbound destination), `link_domain`, `dominant_color`, `is_owner`, `note`, and declared omissions.
- `title`, `description`, and `alt_text` are **forbidden** in source properties for the same reason `tweet.json` forbids `text` — they live once, in their elements or on the element association.
- Volatile metrics (`save_count`, `pin_metrics`) must not participate in semantic identity.

## 10. Candidate model, eligibility, ordering, limits

A pin's text is weaker and more optional than a tweet's. Both title and description are frequently empty, and the image is always the point. Element construction:

1. Title and description, when non-empty, combine into one leading `text/plain` element with `role: "content"`. They are not two elements — a pin has one caption conceptually, and splitting it would produce a stream of one-word elements.
2. The image follows, at the **largest available size** Pinterest returns.
3. `alt_text` attaches to the association, not the byte object.

Because a pin need not have text, no code may assume a leading text element. That assumption is X-shaped and must not migrate into shared platform code. (Confirmed clean: `candidate-bundle.ts` has no text-first assumption — ordering is purely array position.)

The eligibility rule is the general form:

> **A candidate must carry at least one element.** A pin whose media cannot be retrieved and which has no title or description yields nothing and is excluded with a declared reason.

**Secret boards are out of scope initially.** Requesting `boards:read_secret` widens the consent prompt for every user in order to serve a minority case, and a user importing a secret board into a Vibe deserves a deliberate decision rather than a silent default. Add it later, behind its own explicit affordance.

Ordering is board order — Pinterest's own sequence for that board — with the stable pin id as tie-breaker. This differs from X, where newest-first was correct because a timeline is chronological. **A board is arranged, and its arrangement is the curation.** Preserving it is the point.

Limits follow Are.na rather than X, because a board is a channel-shaped object:

```
maxCandidates: 200
maxCaptureBytes: 64 MiB
maxElementBytes: 10 MiB
maxTotalElementBytes: 40 MiB
```

Pinterest images are typically well under 10 MiB, so omissions should be rare. VERIFY reports: pins examined, excluded-as-empty, eligible, imported and cap, and omissions by deterministic reason.

## 11. Capture

Resolve the board URL to a board id, read board metadata for the Vibe title, then paginate the board's pins with Pinterest's bookmark cursor until the 200 cap or exhaustion. Retrieve image bytes during capture and write a versioned capture archive with MIME `application/vnd.rhizome.pinterest-board+zip`.

The attachment walk is the same deterministic algorithm as X §9: source order, skip oversize, skip what would breach the aggregate budget, keep checking later smaller items, record every omission. The server re-parses the capture as untrusted, validates schema and limits, hashes contents, and runs VERIFY before staging.

Video pins are deferred (§18): the media shape is unverified, and images are the overwhelming majority of board content.

## 12. Host and destination

No host changes beyond the `oauth2_pkce` → `oauth2` rename. The board URL field renders from the manifest through the existing generic input-field path — the same code that renders Are.na's channel URL field — so the host learns nothing about Pinterest.

The default Vibe title is the **board's own name**, with no handle prefix. This is a genuine improvement over X, where `@handle Tweets` was a synthesized label because a timeline has no name. A board arrives already named by its curator, and that name is better than anything Rhizome would construct.

## 13. Operator configuration and access tiers

```
RHIZOME_PINTEREST_OAUTH_CLIENT_ID
RHIZOME_PINTEREST_OAUTH_CLIENT_SECRET   required
RHIZOME_PINTEREST_OAUTH_ENABLED
```

Mirror the X settings loader including the `lifecycle_only` availability state that keeps a disabled adapter installed for revocation.

**Access tiers matter for sequencing.** Trial access sandboxes *created* pins and boards and is rate-limited per day per app. Rhizome only reads, so Trial access is plausibly sufficient for an alpha with a small number of users — worth confirming in S1 while testing account types. Standard access requires app review with a demo video showing the auth flow; start that track early since it gates real users, but it should not block development.

Two environment notes: the redirect URI must be registered exactly, and `RHIZOME_BASE_URL` defaults to `http://localhost:3000`, so local development needs an HTTPS tunnel if Pinterest rejects plaintext callbacks (S4).

## 14. Tests and quarantine

**Generic platform.** Add a synthetic OAuth conformance source declaring `pkce: "none"`. This is the load-bearing test of the contract change: it must cover state replay, expiry, actor and callback binding, open-redirect prevention, token non-leakage, refresh serialization, and disconnect, and must assert both that `code_challenge` is absent from the authorization URL and that no verifier is passed to the adapter. The existing S256 synthetic source stays unchanged, proving both paths coexist.

**New generic coverage this provider forces:** a synthetic OAuth source that also declares a `target: "source"` input field, proving connection and caller-supplied configuration compose. Nothing currently tests that pairing.

**Quarantine.** Generalize the X quarantine test into a shared helper parameterized by allowed root and pattern list, then instantiate for X and Pinterest. Cheaply supporting a third provider is itself part of the generalization claim. Pinterest patterns: `pinterest_board`, `api.pinterest.com`, `pinterest.com/oauth`, `boards:read`, `pins:read`, `user_accounts:read`, `RHIZOME_PINTEREST_*`.

**rNet.** `pin` schema validation and generated-type tests.

**Pinterest skill.** Mocked token, refresh, revoke, `/v5/user_account`, board resolution, board pins pagination, and image download. Plus: board URL parsing including trailing slashes and section URLs; a board id that does not belong to the connected user; the 200 cap across page boundaries; board-order preservation; `alt_text` association; title-and-description combination including both-empty; the empty-candidate exclusion; and omission accounting under both budgets.

No large generated snapshots; reuse fixture bytes.

## 15. Implementation sequence

1. **Contract generalization.** The `oauth2` rename plus the `pkce` discriminant, with the non-PKCE synthetic conformance source. **No provider code.** This PR is independently valuable and answers whether the OAuth abstraction generalizes.
2. **Shared quarantine harness** and the rNet `pin` type. Parallel with step 1.
3. **Pinterest skill core:** boundaries, contracts, config loader with mandatory secret, manifest with the board URL field, normalized-pin representation, candidate compiler, VERIFY, fixtures.
4. **Pinterest OAuth connection:** client with Basic auth, `authorizationUrl`, `exchange`, `/v5/user_account` identity, sealed token set, refresh, revoke, provider-error mapping.
5. **Pinterest capture:** board resolution, pin pagination, image retrieval within limits, capture archive, untrusted server re-parse.
6. **Registration and end-to-end:** catalog entry, mocked E2E, host test proving no Pinterest branch.
7. **Hardening:** operator documentation, Standard access submission, recorded follow-ups.

**S1 (§16) runs before step 3** and ideally before step 1 is merged, since a bad result changes the provider decision rather than the implementation.

## 16. Spikes

**S1 — can a personal Pinterest account authorize and read its own boards? Run first; it gates the provider choice.**
Create the app under a business account, complete the OAuth flow signed in as a *personal* account, then call `/v5/user_account`, `/v5/boards`, and one board's pins. Record the `account_type` value returned and whether any call fails with `consumer type is not supported`. While there, confirm whether Trial access is sufficient for these read calls.

**S2 — does Pinterest accept and enforce PKCE?**
Authorize with a `code_challenge`, then exchange with a deliberately **wrong** verifier. If the exchange succeeds, PKCE is accepted but not enforced — `pkce: "none"` is the honest declaration. If it fails, Pinterest genuinely verifies and can declare `S256`. Either result leaves the §3 contract change correct, because the mode rename stands on its own; a positive result simply means Pinterest takes the strong path. Cheap test, materially better outcome — run it before writing the adapter.

**S3 — exact field names and pagination:** board and pin response shapes, `account_type` enum values, bookmark pagination and page-size ceiling, and the image size keys so §10's "largest available" rule is well defined.

**S4 — callback requirements:** whether Pinterest rejects plaintext `http://localhost` redirect URIs, which determines whether local development needs a tunnel.

## 17. Definition of done

- The connection mode is `oauth2`, PKCE is explicit per adapter, and synthetic conformance covers `S256`, `none`, and OAuth-plus-source-configuration.
- A user connects Pinterest, pastes a board URL, and imports up to 200 pins into a new Vibe named after the board, in board order.
- Titles and descriptions arrive as one leading text element where present; images follow with association-level alt text; media-only and text-only pins both import.
- Pins yielding no elements are excluded with a declared reason, and VERIFY explains every count.
- Original provenance is preserved as source facts on every pin.
- Expired or revoked credentials surface through the existing generic envelope.
- The host and server contain no Pinterest-specific branches, enforced by the shared quarantine harness for both X and Pinterest.
- X, Are.na, CSV, OFX, and SimpleFIN behavior is unchanged.
- Mocked Pinterest capture runs in CI without live provider access.

## 18. Deferred

- Secret boards behind an explicit affordance and the `_secret` scopes (§10).
- Video pins (§11).
- A generic connected-source option-discovery capability — the dynamic board picker, which would also serve playlist-shaped sources (§5).
- Importing multiple boards, or a whole account, in one operation.

## 19. Provider references

- [Set up authentication and authorization](https://developers.pinterest.com/docs/getting-started/set-up-authentication-and-authorization/)
- [Understanding access tiers](https://developers.pinterest.com/docs/key-concepts/access-tiers/)
- [Pinterest API v5 reference](https://developers.pinterest.com/docs/api/v5/)
- [Using business access permissions](https://developers.pinterest.com/docs/reference/business-access/)
