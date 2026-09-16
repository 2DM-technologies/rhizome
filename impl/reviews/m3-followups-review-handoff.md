# M3 follow-ups — complete Claude re-review handoff

## Current review scope

All previously unpublished code from the primary checkout is now included in four follow-up PRs after the unchanged #35–#42 stack. This packet supersedes the earlier overlap-only handoff for a review of the whole application. Historical reports remain evidence for their recorded revisions; their successful reviews do not cover these new changes.

- Existing published stack base: #42, `c4efffb7df01df370b9a4f10847bf5e247c7c354`.
- Combined follow-up code head: `178aa4ece81a3e7ee1d72a1071750a9c078c2514`. Later packet-only commits may follow it on #46.
- Canonical schema prerequisite: [rNet #5](https://github.com/2DM-technologies/rnet/pull/5), `e297130b6dd156aa2d961b3ba873b1b8734a1add`, based on `036288c4064fb978399c6cb3eaba8f0699afa37c`.
- Complete incremental application diff: `c4efffb7df01df370b9a4f10847bf5e247c7c354..178aa4ece81a3e7ee1d72a1071750a9c078c2514`.

## PRs and ownership

### #43 — canonical platform recency

[PR #43](https://github.com/2DM-technologies/rhizome/pull/43), branch `m3/followup-01-platform`.
Base `c4efffb7df01df370b9a4f10847bf5e247c7c354`; head `871cf35ef740afb6936f7b284f60b482b8778c09`.

- Add `vibes.updated_at`, a non-null timestamp with an insertion default and ORM update hook. Wire serializers and host recency to required, typed `Vibe.updated_at`; remove the private extension implementation.
- Touch Vibe recency when authored object creation adds membership. Keep schema, fixtures, serializers, and consumers aligned.
- Add repository guidance against storing platform-owned fields in extensions or generic JSON bags. Third-party extension passthrough remains legitimate.
- Both CI jobs pin the rNet prerequisite commit above. Merge rNet #5 before the application follow-ups. The database change is additive; the wire field is newly required.
- Review recency semantics across creation, title/inference changes, membership changes, and imported Vibes. Preserve the existing authorization and revision rules.

### #44 — inference context and generation

[PR #44](https://github.com/2DM-technologies/rhizome/pull/44), branch `m3/followup-02-inference`.
Base `871cf35ef740afb6936f7b284f60b482b8778c09`; head `1d9ddbea213a5e5e4eaa7a010e189b81b8823a0b`.

- Object context cap grows from 2 to 32 KiB, Vibe metadata from 8 to 64 KiB, and strings from 512 to 8192 UTF-16 units. This preserves element descriptions alongside verbose source metadata. Total token, attachment, call, and wall budgets remain enforced.
- Orb identities prioritize explicit color evidence, then concrete subject associations, then mood. Remove hue-anchoring examples from the prompt; retain representative identities as test fixtures. No live-provider quality evaluation is claimed.
- Vibe view generation uses a nested discriminated union so `view` and `config` cannot come from different branches. Decode the model envelope into the unchanged stored output shape, then retain output/pointer validation and metering.
- Review schema cache lifetime, malformed output, decoded nulls, pointer validity, and existing concurrent accounting/overlap behavior.

### #45 — host UI and idle resources

[PR #45](https://github.com/2DM-technologies/rhizome/pull/45), branch `m3/followup-03-host`.
Base `1d9ddbea213a5e5e4eaa7a010e189b81b8823a0b`; head `892515cff062cfb2141ebfa83b4ebb5d0a8bbe4d`.

- `b642716` extracts inferred Vibe view components into `surfaces/vibe-view`; `809d62c` contains the host behavior/style changes; `e5dfa6e` aligns desktop-loading coverage with five previews and checks the sixth item remains unloaded.
- Recent dock routes include objects/apps as well as Vibes. Shell session storage advances to version 5; older disposable shell state is discarded. Add shared media thumbnails, Vibe deletion controls, PDF object rendering, wallpaper transitions, and updated dock/preview styling.
- Desktop cards show five 24px thumbnails. Existing near-viewport gating, retained thumbnail caches, small-text limits, and metadata-only unsupported previews remain required.
- Hero and active dock orbs animate on interaction; settled idle surfaces stop drawing. Renderer playback is 1.5x. Reduced-motion, context-loss recovery, raster reuse, and retained desktop behavior must survive.
- Idle status polling is 10 seconds; active waiting/running work polls every second. Local starts and completion invalidate both Vibe and object status immediately, including failures with no result. Work started elsewhere can take up to 10 seconds to appear. This tradeoff was approved in the performance task.
- Desktop Vibe cards use the default cursor; the Vibes list keeps its pointer cursor.
- The latest dot moves down 1px. Running dock shortcuts use their focus label without the clipped purple outline; active cards retain their focus outline.
- Review navigation persistence, destructive-action focus/error handling, theme transition cleanup, and status transitions across local and external work.

### #46 — API metadata, speculative material, and this packet

[PR #46](https://github.com/2DM-technologies/rhizome/pull/46), branch `m3/followup-04-speculative`.
Base `892515cff062cfb2141ebfa83b4ebb5d0a8bbe4d`; code head `178aa4ece81a3e7ee1d72a1071750a9c078c2514`.

- Move `apps/server/test/store.integration.test.ts` to `impl/speculative/store.integration.test.ts`, preserving dependency resolution and TypeScript inclusion. Bun still discovers and executes it.
- Move `impl/concepts/strava-import.md` to `impl/speculative/strava-import.md` and update links. This does not implement Strava.
- Remove the two private OpenAPI annotations. Standard `UserBearer` and `ClientBearer` security schemes retain the distinction between user-only, client-only, and either-identity operations. Separate security entries express either-identity access; public routes also allow anonymous access. Server route enforcement is unchanged. Client generation recognizes multipart request bodies by their standard media type and still emits `FormData`; the generated client contract is unchanged. An OpenAPI assertion rejects platform-prefixed annotations.
- Later packet-only changes publish this handoff and link it from the prior stack packet.

Merge order: original #35–#42 stack, then #43 → #44 → #45 → #46, with rNet #5 merged before #43. Keep stacked ancestry intact; no merge is requested by this review handoff.

## Focused review outcome and final follow-ups

Claude independently reviewed rNet `e297130b`, #43 `871cf35e`, #44 `1d9ddbea`, #45 `e5dfa6ee`, and #46 code `c27e480b` (packet `01b9adec`), finding no merge blockers. The report remains at `impl/reviews/m3-followups-review-claude.md` in the primary checkout.

Both nonblocking P3 findings are addressed at the current code heads:

- #45 `892515c`: refresh object inference status on local push start and completion alongside Vibe status. A regression verifies that a failed push with no result refreshes an active object's cached status. This commit also applies the requested default cursor to desktop Vibe cards. Playback remains 1.5x following the owner's final preference.
- #46 `178aa4e`: document user/client auth using standard named bearer schemes, with assertions for user-only, client-only, either-identity, and optional identity. No private annotation is reintroduced; generated client types remain unchanged.
- Final focused verification at combined code `178aa4e`: **82 unit/API tests passed** (74 host and 8 OpenAPI), **8 browser tests passed** (inference polling and orb performance), plus TypeScript, generated-client freshness, formatting, and diff checks. Full application and browser gates were not rerun locally for these small changes; check CI on the new published heads.

## Validation and limitations

- rNet: full `bun run check`, **41 pass / 0 fail**, including generated-schema freshness and types.
- #43: full `bun run check`, **608 pass / 0 fail**.
- #44: full `bun run check`, **611 pass / 0 fail**.
- Combined implementation before the API metadata cleanup, `4e04c4e1ccbc55bd22d7e7d67ba9809010ffde3f`: full `bun run check`, **609 pass / 0 fail**, including formatting, OpenAPI freshness, types, builds, and the relocated speculative integration suite. The host removes obsolete shell compatibility tests, so totals differ from the preceding PR.
- Combined Chromium run at `4e04c4e1ccbc55bd22d7e7d67ba9809010ffde3f`: **141 pass / 0 fail**. An initial run passed 140 and exposed a stale six-thumbnail expectation. The corrected test passed a focused three-test suite and the complete rerun. No application behavior, timeout, or assertion bound was relaxed to hide a failure.
- Latest API metadata cleanup: **8 OpenAPI tests passed**, plus generated-client freshness, formatting, TypeScript, and diff checks. No host application code or generated client type changed. Check the new #46 CI run separately.
- Code preservation audit: the complete original local source snapshot merged onto #42 matched the published source byte-for-byte, except the required CI schema pin. Subsequent source/test edits were the desktop-loading expectation/extra unloaded-item assertion and the API metadata cleanup described above.
- The earlier performance task measured idle renderer CPU around **0.18% of one core** versus **11–12%** before, zero idle animation frames, and 12 rather than about 100 requests over 25 seconds. This was a short local measurement, not a leak study or performance guarantee. Evidence: `.rhizome/idle-optimization-20260915/REPORT.md` in the primary checkout.
- The earlier independent Codex overlap re-review found no new actionable defect at #42 `c4efffb`. Its full gates passed 605 deterministic and 134 browser tests, plus race, grant, coalescing, and negative-control probes. That conclusion covers the old overlap repairs, not the new follow-ups.
- CI status can change; check the exact published heads. Do not treat local passes as completed GitHub checks.

Current validation logs:

- `/Users/noahputnam/2dm/rhizome-followup-validation/.rhizome/publish-followups-20260915/check-platform.log`
- `/Users/noahputnam/2dm/rhizome-followup-validation/.rhizome/publish-followups-20260915/check-inference.log`
- `/Users/noahputnam/2dm/rhizome-followups/.rhizome/publish-followups-20260915/check-final.log`
- `/Users/noahputnam/2dm/rhizome-followups/.rhizome/publish-followups-20260915/browser-final-rerun.log`

## Earlier repairs that must survive

Use the preceding [stack packet](./m3-pr-review-handoff.md) for the complete historical checklist. In particular preserve validator collectability, deleted-record/grant protection, bounded concurrent metering and terminal cleanup, fresh derived orb composition, eligible-sibling progress after automatic waits, bounded stalled-row retirement, nonblocking membership responses, and durable result coverage. Retained desktop DOM, preview download bounds, and elapsed-time orb settling remain required.

Previously documented residual P3/M7 limits remain unless a follow-up above directly addresses one: queued-import pending display, dead activity/log branches, extra zero-call deterministic skips, identical-recipe rewrites, broader durable restart/resumption and freshness policies. Verify new impact before relabeling an inherited issue as a new defect.

## Review environment and requested output

Perform an independent read-only review of the exact revisions above using isolated worktrees. Checkout rNet at `e297130b6dd156aa2d961b3ba873b1b8734a1add` in the sibling path expected by the workspace dependency. Use a newly migrated dedicated database and explicitly set both `DATABASE_URL` and `RHIZOME_TEST_DATABASE_URL`, plus an empty `OPENAI_API_KEY` and fake connectors. Our validation DB was `rhizome_publish_followups_20260915`; use a different one for your review. Coordinate browser port 4173 or configure a separate review port.

Do not modify the primary checkout, restart shared app/storage services, reset user data, call live providers, publish comments, commit, push, or merge. Preserve historical reports. Save a new report, suggested path `impl/reviews/m3-followups-review-claude.md`, with exact reviewed revisions, evidence-backed findings, owning PR and file/line, tests/probes run, remaining uncertainty, and a merge-readiness verdict.
