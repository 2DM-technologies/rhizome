# M3 — PR stack review handoff

This is the single context packet for agents reviewing the seven conceptual PRs split from [#33](https://github.com/2DM-technologies/rhizome/pull/33), plus the separately approved bounded-concurrency PR #42. Assign each agent one PR; this packet includes the exact incremental review targets, full file manifests, decisions, repair dispositions, and test setup. No earlier conversation is required.

## Current state — September 15

The independent Codex re-review found five remaining P2 gaps in checklist items 2, 9, 10, 13, and 16. Those five now have repairs and regression coverage in their owning PRs. The original 21-item checklist is addressed in the current code pins below. Earlier Astra repairs are retained. Descendants carry the repairs through ordinary merges; no history was rewritten. The parallel-batches implementation was completed in the visible **Parallel LLM batches** task and integrated after the repaired seven-PR stack as a separate conceptual change.

These are draft PRs with the follow-up repairs validated locally. Verify the current published-head CI before beginning another review. This packet does not claim that every P3 or every finding from the earlier #33 report is fixed. Remaining issues and deliberate policy choices are listed below.

### Claude checklist dispositions

1. **#35 — cache-write metering:** read the documented nested `input_tokens_details.cache_write_tokens`, retain billed-failure usage, accept absent/null optional detail counters, and reject impossible token totals. The provider guide was verified during implementation: [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).
2. **#36 — deleted elements:** exclude tombstones from acceptance, context, loading, and status; skip accepted elements deleted before preparation; refuse tombstoned writes under the record lock. Reload each live element at its lazy preparation boundary before reading bytes. Regressions cover deletion before acceptance, before execution, during a model call, and a sixth image deleted while earlier batches are held (#36 serial; #42 two concurrent batches).
3. **#36 — deletion race:** re-read the operation after either 403 or 404 from Vibe scope lookup, applying deleted-Vibe rules only when the fresh foreign key is null.
4. **#36 — post-deletion privacy:** null-Vibe push results are owner-only. Other operation kinds retain their existing invoker/redaction behavior; push-only callers cannot gain record-list access after deletion.
5. **#39 — orb settling:** elapsed-time decay and stable bounded spring steps preserve settling at slow frame rates. No assertion timeout was increased.
6. **#36 — sticky 409:** a conflicting accepted operation covers the task; a 409 rejection no longer creates a permanent pending error.
7. **#37 — overlapping graphs:** automatic graphs queue per Vibe; different Vibes can progress independently. Only the active graph owns pending activity, and empty/keyless graphs leave it untouched. Per-run activity keys are unnecessary under this serialization.
8. **#37 — title precedence:** use the graph's own summary revision. Rename only a newly imported placeholder title, atomically while the current title still matches; preserve explicit confirm titles and owner renames.
9. **#40 — stale automatic results:** task status transitions refresh Vibe, object collection, object, and loaded element queries even when the Vibe revision stays constant. The status contract includes nullable `operation_id`; the host invalidates when it changes, including a second run that starts and completes between polls at unchanged Vibe revision. Observe an object-level task and the control's selected task so “Run on missing” updates after server-started work.
10. **#41 — desktop downloads:** gate cards near the viewport and supported preview kinds, use authorized cached 64px image thumbnails, and retain small thumbnail blobs for five minutes after the last subscriber. Text previews are fetched only when metadata declares at most 16 KiB and also retain their blobs for five minutes. Video and oversized/unknown-size text use metadata placeholders. Repeated desktop cover/reveal does not re-download these previews; opening the object retains normal full-media behavior.
11. **#41 — clipped panels:** keep outer scrolling until the two-column `xl` breakpoint.
12. **#38 — all-zero palettes:** semantic post-validation skips invalid identities, preserving valid siblings and reported usage; individual zero-weight stops remain allowed.
13. **#36 — status scan scope:** restrict operation queries to readable memberships of the requested object and other parents of its returned elements, plus owned deleted-Vibe history, before record-selection matching. Use each Vibe's actual owner for authorization; shared-element running/error status is visible through both readable parents, while removing a read grant hides it.
14. **#36 / #42 — safe diagnostics:** unexpected execution failures log operation UUID and a fixed error classification. The concurrent dispatcher and accounting boundaries retain this logging without exposing provider bodies.
15. **#36 — JSONB strings:** NUL and unpaired UTF-16 strings become record-level invalid output, preserving valid siblings, later batches, and metering; Vibe output is checked too.
16. **#35/#36 — validator lifetime:** each weak-key cached validator owns a collectible compiler lifetime. There is no process-lifetime Ajv scope holding every transient schema. A 100-schema regression verifies exact validation and bounded retention of dropped schema WeakRefs. It allows one conservatively retained JavaScriptCore temporary; the old shared compiler still fails this regression with all 100 references alive.
17. **#36 tests — image race:** verified S3rver 3.7.1 acknowledges PUT before its backing file finishes. The fixture now waits for the exact backing-file length before running the intentionally oversized-payload check. Checking through GET could race a growing response stream and timed out in CI; filesystem readiness avoids that race and passed 20 repeats. Runtime attachment limits remain enforced.
18. **#37 — Are.na titles:** trim/cap source destination titles to 256 UTF-16 units without a trailing unmatched surrogate.
19. **#38 — neutral orb coverage:** valid neutral identities emit real inferred coverage with the neutral fallback recipe, avoiding permanent loading.
20. **#40 — terminal feedback:** display result tallies, failed-call counts, operation errors, and ceiling reasons; retain a saved summary during a rerun.
21. **#41 — Escape:** pending title saves and the object JSON editor keep their window open; ordinary title editing still cancels before window close.

Additional approved Are.na changes are in #37: final limits are 640 MiB capture, 160 MiB per asset, and 400 MiB total media. The source forwards those limits and the installed public fetcher accommodates them. Blank/whitespace image descriptions are treated as absent for image blocks and link previews; meaningful descriptions and malformed-value rejection are preserved. Stored source/provider/embed destinations now accept HTTP or HTTPS without credentials; actual media downloads still require HTTPS. The reported Urban Computing capture was replayed and verified by the source task (28 blocks, 56 elements).

The latest approved host change is in #40: document cards show a lightweight Document/MIME placeholder and fetch no PDF bytes on the board. Opening the object loads the document normally. This was validated in the intermediate host and combined desktop, with TypeScript and a focused browser regression.

## Published stack and merge order

- **[#35 — M3: define push contracts and the inference connector boundary](https://github.com/2DM-technologies/rhizome/pull/35)**; base `main`.
- **[#36 — M3: execute and meter scoped push tasks](https://github.com/2DM-technologies/rhizome/pull/36)**; base `m3/review-01-foundations`.
- **[#37 — M3: enrich confirmed imports through source-declared task graphs](https://github.com/2DM-technologies/rhizome/pull/37)**; base `m3/review-02-push-engine`.
- **[#38 — M3: infer object orb identities and compose Vibe recipes](https://github.com/2DM-technologies/rhizome/pull/38)**; base `m3/review-03-import-enrichment`.
- **[#39 — M3: render glass orbs with bounded live resources and raster caching](https://github.com/2DM-technologies/rhizome/pull/39)**; base `m3/review-05-orb-identities`.
- **[#40 — M3: show inferred views, task progress, and tweet feeds](https://github.com/2DM-technologies/rhizome/pull/40)**; base `m3/review-06-orb-rendering`.
- **[#41 — M3: retain the desktop and focus page windows in the shell](https://github.com/2DM-technologies/rhizome/pull/41)**; base `m3/review-04-inferred-views`.
- **[#42 — M3: overlap LLM batches with bounded process concurrency](https://github.com/2DM-technologies/rhizome/pull/42)**; base `m3/review-07-desktop-shell`.

Agents may review all eight PRs concurrently. Merge in that order, preserve ancestry, and reconcile each remaining base after its parent lands. Do not squash a parent and assume downstream diffs stay correct. No merge, history rewrite, deployment, live provider call, or GitHub review comment is authorized by this review packet.

## Immutable source and recovery

- Original feature branch: `m3/01-push-pipeline`, at `f75bd8e443d6fe7ee8cce905508d0e974876c958` when split. Its aggregate branch remains separate. The shared primary checkout now uses local branch `m3/local-latest` at the earlier #42 tip plus unpublished edits from other tasks; it is not a clean PR-review target.
- Original main: `220e289be5b064b6b5e80803c8a2f5e99698872c`.
- Repaired seven-PR application head: `17d3a18b928b05feedebf7fee0f3041791a01000`.
- Combined concurrency application head: `82cf4446bde2618f6aa491a13bc5cb62bcebadde`. The original concurrency commit was `8419decd0353b49688616a88a0f2879fc49c4cbb` on `25392267436def7c9c295ef149ad38e9ef1a811d`; an ordinary merge reconciled it with all repairs.
- Documentation-only commits updating this packet, and downstream merges carrying those docs, may follow these code pins. Review each pinned base-to-code-head diff and inspect later commits separately. The pinned #41 base for the concurrency review deliberately excludes handoff-only updates.
- Before repairs, original and split had identical tree `0f05054c92a31e86f928007bf8072bc6dec9acdc`. New repairs intentionally change that tree. Original scope was 44 commits, 262 files, 25,129 insertions and 1,258 deletions plus binary assets.
- Recovery ref: `refs/backup/pre-split-20260914-220544`, commit `6e71545cc23084ee1ceb0d2efd8e453eb6dd9f59`.
- Primary checkout: `/Users/noahputnam/2dm/rhizome`; repairs: `/Users/noahputnam/2dm/rhizome-pr-split`; concurrency integration: `/Users/noahputnam/2dm/rhizome-parallel-batches`.
- Original [#33](https://github.com/2DM-technologies/rhizome/pull/33) remains the base for the separate [Strava #34](https://github.com/2DM-technologies/rhizome/pull/34). Do not merge both the aggregate and this replacement stack or retarget #34 as part of review.
- Historical reports: `/Users/noahputnam/2dm/rhizome/impl/reviews/m3-stack-review-claude.md` and `/Users/noahputnam/2dm/rhizome-stack-review-20260915.md`. Their findings/line numbers refer to their recorded old heads. Preserve them as historical evidence.

## Copy/paste prompt for a new review agent

Replace `PR_NUMBER` with one of 35–41 or 42. Give the agent this whole file or the linked copy.

```text
Review Rhizome PR #PR_NUMBER using the complete handoff:
https://github.com/2DM-technologies/rhizome/blob/m3/review-07-desktop-shell/impl/reviews/m3-pr-review-handoff.md
Local copy: /Users/noahputnam/2dm/rhizome/impl/reviews/m3-pr-review-handoff.md

Find your PR's exact base/code-head revisions and complete file manifest below.
Review its incremental base-to-head diff, not the entire cumulative stack or only
its last commit. Read adjacent code and descendant integration as needed, but
distinguish defects introduced here from features intentionally added by later PRs.
The shared product decisions describe the finished stack.

This is an independent read-only code review. Preserve user work and local data.
Do not edit implementation, commit, push, rewrite history, open/merge PRs, publish
comments, reset data, or invoke live model/source providers. The shared dev server
on 5173 must remain running. Database tests truncate fixtures: use an explicitly
isolated test database. Coordinate browser suites that own port 4173.

Find actionable correctness, authorization, data-loss, resource-lifecycle, and
performance defects. Do not pad the report with style preferences or requests for
explicitly deferred features. Distinguish evidence, hypotheses, and known issues.

Return:
1. PR number, exact reviewed base/head, coverage, and exclusions.
2. Findings ordered by severity (P0 urgent universal failure, P1 high-impact
   blocker, P2 normal bug, P3 low-impact issue). For each: short title, file:line
   at the reviewed head, trigger, expected/actual behavior, impact, evidence or
   reproduction/test, minimal repair direction, and confidence.
3. Tests run, results, and environmental limitations.
4. Cross-PR dependencies and the PR that should own the repair.
5. Remaining uncertainty. If no actionable defect was found, say so clearly.

Known issues are listed in the packet. Do not report them as new independent
findings without adding evidence about cause or impact. Do not label an observed
failure flaky or change a timeout without establishing intended behavior.
```

## Product decisions and scope

Rhizome is the product Store and React host for rNet. The sibling `rnet` repository defines the protocol; Rhizome imports it, never the reverse. Bun/Hono/Postgres run the server, React/Vite/React Router run the host, and `packages/store-contract` carries browser-safe HTTP schemas. CI pins sibling rNet at `036288c4064fb978399c6cb3eaba8f0699afa37c`.

- Push is asynchronous at element, object, and Vibe levels, with server-enforced scope, deduplicated selections, strict output/ref validation, per-operation metering, row-locked inferred writes, and honest partial-failure results. Store tasks write their own `rhizome:{task}` key, preserve durable entries, and leave other writers intact.
- The seven installed task names are `describe-media`, `display-name`, `search-keywords`, `orb-identity`, `summarize`, `vibe-view`, and `vibe-orb`. The provider is optional; no live credentials/spend are needed for the deterministic gate. The configured default model is selected by server configuration, not by per-request choice.
- Source manifests declare an import task graph. The content graph starts with `describe-media → display-name → search-keywords`, then splits into `summarize → vibe-view` and `orb-identity → vibe-orb`. Ready nodes may overlap; settled failure unblocks later nodes. Empty graphs on transaction sources are intentional. Confirmed existing-Vibe imports enrich additions, refresh applicable whole-Vibe tasks, and retain the owner's title.
- Object `orb-identity` version 1 supplies reusable palette/field/surface/motion character. Shared Vibe recipe version 3 is deterministically composed from distinct saved object identities with a stable seed. `vibe-orb` is a rules task; the former Vibe-level image-sampling/semantic-inference design is superseded.
- **Latest explicit user correction: retain the desktop after its first visit.** `DesktopHome` uses React Activity to preserve DOM/scroll/state and pause effects behind a page window. Do not restore the earlier desktop-unmount proposal. A direct page load need not prepare an unseen desktop.
- **Only the focused page window mounts.** Home mounts no page window. Open/recent/pinned routes are metadata and must still reopen; the user accepted loss of a page window's scroll and unsaved component state when that window unmounts. The retained desktop is a separate exception.
- Small orbs use cached raster images while inactive. Hover activation is delayed 100ms and canceled immediately on leave; keyboard focus and the active dock square are immediate. Numeric icon sizes <=48 use a two-idle-painter pool, a 30 FPS cap, and DPR cap 1.5. Detached idle resources do no drawing, expire after 30 seconds, and clear on pagehide/HMR. Other live renderers default to 60 FPS and DPR cap 2.
- Orb event invalidations coalesce through RAF; settled recipes stop interpolation-array allocation and unchanged recipe uniform uploads. Preserve appearance, shader motion speed, fallback/loading identity, reduced motion, and initial layout sizing. The performance pass was not permission to alter prompts or recipes; the branch intentionally also includes separately developed orb model/task changes.
- User requested preservation of local data and other tasks' work. All existing changes, including the separately edited Vibes SVG, were explicitly committed and pushed together. No data reset is part of this review request.

The first engine/import slices install the five non-orb tasks. Orb identities and composition add the final two in #38. Earlier PRs intentionally retain the existing desktop/window behavior; #41 introduces the final retention and focus policy. Do not require a future slice to be present in an earlier slice.

The final concurrency layer keeps the declared dependency graph, task prompts, batch sizes, schemas, grants, and durable-entry protections. Default capacity is two complete batches per operation and four logical connector calls across the process, including Vibe calls. Each call records all reported usage before its writes; every started call and write settles before terminal finalization. Call/token ceilings stop new admission but allow admitted calls to write. Fatal/wall stops suppress further inferred writes; an already-entered transaction settles.

The 400k token ceiling measures observed usage, so already-admitted calls can overshoot it. At the default two batches, the crossing call has at most one other admitted batch. The 40-call ceiling is exact and unchanged; orb-identity still covers at most 480 objects at 12 per call. No live-provider latency improvement has been measured. No queue service, distributed scheduler, or restart recovery was added.

## Validation

### September 15 Claude concurrency follow-up

Claude's independent re-review examined the earlier combined head `78401b3`, before the five P2 follow-up repairs in this packet. Its two remaining P2s (validator lifetime and desktop text/video downloads) are covered by those later repairs. Two additional #42 P3s have now been fixed at `82cf4446bde2618f6aa491a13bc5cb62bcebadde`:

- Always clear per-operation activity in `finally` if the terminal transaction fails. Paid writes and usage already persisted remain intact; database recovery after a failed finalization remains outside this repair.
- Let the packer classify already-prepared oversized lookahead before declaring a call/token ceiling abort. Call admission still enforces the ceiling, and image preparation checks it before any further payload read. Serial and concurrent object/image probes verify correct completion and no additional downloads past the allowed lookahead.

Both targeted regressions fail against the previous implementation and pass after repair. The complete deterministic gate passed **596 tests**, API freshness, formatting, types, and builds. Logs: `/private/tmp/rhizome-claude-followup-20260915/check.log` and `negative-control.log`. Verify CI on the final published head; this paragraph does not claim a browser rerun on this code yet.

**Owner policy choice remains open (#37):** a manual run on different objects currently makes an additions-only graph treat the task as covered, so the additions can be left unenriched. Recommended behavior is to wait for the conflicting run and then enrich uncovered additions; alternatively show an explicit skip explanation. No policy change is included in these two #42 repairs. Other P3s and explicit deferrals from the original reports remain as documented.

### September 15 independent re-review follow-up

- Clean combined repairs at `1593ffe` passed `bun run check`: **593 tests**, OpenAPI freshness, formatting, types, and production build. Full Chromium suite: **134 passed**. Logs: `/private/tmp/rhizome-rereview-fixes-check.log` and `/private/tmp/rhizome-rereview-fixes-browser-full.log`.
- Final stack integration retains the tested application implementation. The only later test change tolerates one conservatively retained JavaScriptCore temporary in the GC regression; a negative control using the previous compiler still fails with all 100 schemas retained. See `/private/tmp/rhizome-validator-negative-control.log`. The #36 backport separately passed type checking and both real-DB repair probes on its serial engine; #42 retains the two-batch deletion regression.
- The new tests assert repaired behavior, not reproduction of the defect: five calls/five writes for six selected images when the sixth is tombstoned before preparation; authorized shared-element status; changing completed operation identity; compiler collection; one small-text fetch and zero video/oversized-text fetches across three Home reveals.
- Tests used only `rhizome_rereview_fixes_20260915`, with both database environment variables explicit and no live provider key. The running shared app and development data were preserved.
- Historical independent report: `/Users/noahputnam/2dm/rhizome/impl/reviews/m3-stack-rereview-codex.md`. Its five findings describe the prior code pins. Re-review their fixes independently; the report itself is not overwritten.

### Earlier validation (historical code pins)

- **#35:** full local gate at `9066ac6`: 403 tests passed.
- **#36:** full local gate at `c4152f5`: 496 tests passed.
- **#37:** full gate after graph/title/limit changes: 520 tests passed; subsequent blank-alt and HTTP metadata fixes passed the combined 25-test Are.na suites. All descendants include it in their full gates.
- **#38:** eight focused orb tests and TypeScript passed, including neutral identity coverage. The earlier all-zero integration regression remains in the complete gate.
- **#40:** automatic object-refresh cases passed for both done/error without Vibe revision change; six overview/automatic-refresh follow-up cases passed. One obsolete pre-change assertion was corrected to allow the new object-level poll.
- **#41:** full local gate at `5d26f7f`: **570 tests passed**, plus the targeted Escape and repeated-thumbnail-reveal browser cases.
- **Combined #42:** full local gate at `c27c1a9`: **589 tests passed**, including 16 concurrency regressions. OpenAPI freshness, formatting, TypeScript, and production builds passed. Complete browser suite: **130 passed** at `c27c1a9`; the later theme-test readiness assertion passed three focused repeats. An earlier combined run passed 128/129; the remaining test captured a pre-completion GET while the UI already rendered updated inference. Its assertion now checks the final rendered cache value and passed three repeated focused runs.
- The concurrency task independently passed 568 deterministic tests and 125 browser tests before integration; these are historical results, not a substitute for the combined gate.
- Local gates used Bun 1.3.10 and fake providers, with both DB variables explicitly pointing at `rhizome_pr_fixes_20260915`. Full server gates were run without concurrent full browser load; focused browser follow-ups used separate owned ports. The browser suite owns isolated port 4181; the user's 5173 server was preserved.
- Logs: `/private/tmp/rhizome-claude-{35,36,37,41}-check.log`, `/private/tmp/rhizome-ci-repaired-check.log`, `/private/tmp/rhizome-ci-repaired-browser.log`, and the focused `/private/tmp/rhizome-claude-40-*` / `rhizome-claude-41-*` logs. Earlier failed assertions and fixture investigations remain in those logs; no timeout increase was used as a fix.
- GitHub jobs are separate evidence. Inspect Checks on each current PR head; documentation updates can produce heads after the pinned application commits. CI uses Ubuntu 24.04, Postgres 16, Node 24.20.0 for browser startup, and sibling rNet `036288c4064fb978399c6cb3eaba8f0699afa37c`.
- Existing build advisory: host main bundle about 521 kB minified / 159 kB gzip. No live provider or real-device latency benchmark is claimed.

## Remaining findings and limits

This section separates retained behavior from open work; it is not a claim that all 27 findings in the earlier aggregate review have been resolved.

- **Deliberate execution policy:** wall/fatal aborts still suppress new inferred writes even for paid returned output. Already-entered transactions settle, billed usage is retained, and finalization drains all started work. #42 fixes producer-before-call attribution and activity cleanup before finalization. Token overshoot and the 40-call/480-orb-object limit remain as described above.
- **Deferred to M7 / freshness work:** process restart/resumption, spend loss on process death, membership/user-edit freshness, removals while automatic nodes wait, later append/pull enrichment, and complete derived-orb refresh coverage. Automatic graph serialization fixes overlapping confirms; a manual same-task conflict is treated as covered, without a new durable dependency scheduler.
- **Open #35 P3:** `OPENAI_BASE_URL` still expects an origin-style base; `/v1` or empty custom values need configuration normalization/diagnostics. Null optional usage counters and impossible totals were fixed; generally malformed provider totals are rejected rather than guessed. Explicit prompt-cache policy remains an owner decision, not a defect claim.
- **Open #36 P3:** duplicate datatable columns for a pointer observed with multiple kinds; context trimming order; delimiter-safe data framing; Vibe-level workset/assembly scaling. `MeterLedger.close` still updates breakdown/status rather than repairing aggregate columns after a persistence failure; normal recorded calls persist aggregates before finalization. Do not represent DB-failure durability as solved.
- **Open #37/#38 P3:** empty new-Vibe task rows, coarse outer import logging, and identical-recipe rewrites remain. The sticky 409 display error is fixed; a conflicting derived refresh can still be subsumed by an existing run under the Alpha freshness policy.
- **Renderer hypotheses / minor issues:** batched IntersectionObserver crossings, DPR-only changes without resize, and pointer-leave interaction-floor behavior need a focused reproduction before changing rendering semantics.
- **Host follow-up:** idle 1 Hz polling and redundant invalidations remain; mock-store fidelity and the fixed screenshot output path remain test-maintenance items. Object refresh/partial feedback bugs are fixed independently of that polling redesign.
- **Theme/assets:** `design-tiers.md` now documents the actual session theme override and desktop/window lifetime. Wrong-theme first paint is an unverified hypothesis; the 2.09 MB wallpaper remains unchanged.
- **Canonical documentation debt:** older orb and push passages still say six tasks, recipe v1, Vibe-level image sampling, or deferred raster caching. Use the seven-task catalog, identity v1 / recipe v3, deterministic composition, and implemented renderer described here. Layout listings and a few outdated comments also remain. Ignore `impl/speculative/` for implementation. These are follow-ups, not authority to change the shipped design.

CI follow-ups: the original full-sized attachment test passed 20 repeats after its readiness check switched from GET to the owned S3rver backing file. The document-card change required updating the Are.na post-confirm browser expectation from an embedded PDF to a placeholder; the four focused import/document cases pass. The prior concurrency CI run also retried a theme-command case; the test now waits for React to expose the command after the OS-theme change and passed three focused repeats. No test timeout was increased.

The three original investigations now have verified causes: frame-count-bound orb decay (fixed), operation lookup straddling Vibe deletion (fixed, including the privacy follow-up), and premature S3rver PUT acknowledgment (test fixture fixed). Do not keep reporting the image case as unexplained.

## Test environment and coordination

Read root and nested `AGENTS.md`; the user's instruction to preserve development data overrides general disposable-state guidance. Integration tests truncate users and related data. Create an isolated migrated database and set **both** `DATABASE_URL` and `RHIZOME_TEST_DATABASE_URL` to it. Never copy the development `.env`, reset the dev database, or share a test database between concurrent suites.

`bun run test:e2e` normally owns port 4173. Coordinate browser servers or use isolated configuration/ports. Leave the user's 5173 server alone. Keep the pinned sibling `rnet` checkout beside Rhizome. Use injected fakes and keyless fixtures; no live provider/source calls are authorized for review. The single-process Alpha envelope is approximately 1–20 people; do not expand these repairs into a worker platform.

## Cross-PR review responsibilities

- **#35/#36/#42:** billed failure usage, immutable call identities, accounting order, cancellation, and finalization.
- **#36/#37:** serialized automatic graphs, pending status, tombstoned selections, and operation authorization.
- **#37/#40:** title precedence, own-summary attribution, post-confirm navigation, and record/element invalidation.
- **#38/#39/#41:** semantic identity validation, neutral coverage, recipe versioning, raster lifetime, hover/keyboard behavior, and Activity cleanup/reveal.
- **#40/#41:** task polling lifecycle, retained desktop state, editor Escape handling, and the accepted page-window unmount policy.
- **#42 with every predecessor:** concurrency is a separate incremental layer; verify the integration keeps all 21 repaired behaviors and the approved Are.na changes.

## Assignments and exact incremental file manifests

Use these pinned revisions. Review the full incremental diff; files may appear in several concepts with different hunks. Read authored code before generated snapshots. Report line numbers at the reviewed head.

### #35 — concept 1: M3: define push contracts and the inference connector boundary

Adds browser-safe push request/result contracts, optional provider configuration, a fake connector, and a bounded OpenAI Responses transport. Includes structured-output validation, retry/deadline handling, image inspection, and the rNet task-name pin.

**Review focus:** Review provider cancellation, structured-output validation, bounded image reads, usage returned on billed failures, and optional/keyless configuration.

- PR: [https://github.com/2DM-technologies/rhizome/pull/35](https://github.com/2DM-technologies/rhizome/pull/35)
- Branch: `m3/review-01-foundations`
- Base: `220e289be5b064b6b5e80803c8a2f5e99698872c` (`main`)
- Code head: `00b4c57df459768616e3852b1d30b1b8b710cb7a`
- Incremental scope: 34 files changed, 2518 insertions(+), 17 deletions(-)

```bash
git fetch origin m3/review-01-foundations
git diff --stat 220e289be5b064b6b5e80803c8a2f5e99698872c...00b4c57df459768616e3852b1d30b1b8b710cb7a
git diff 220e289be5b064b6b5e80803c8a2f5e99698872c...00b4c57df459768616e3852b1d30b1b8b710cb7a -- path/to/assigned/file
```

**Questions to trace:**

- Are element/object selections constrained to the requested level, and Vibe-level selection rejected? Are task names consistently kebab-case and public status/result shapes closed?
- Do result variants, removal-only outcomes, preserved entries, nullable terminal results, pointers, and serializers agree with generated clients?
- Do model defaults, migration columns/foreign keys, inferred revisions, and operation-linked Vibe revisions line up? Does app construction preserve keyless startup?
- Does generation faithfully include all seven installed task manifests, with the same level/name identity and schema vocabulary as the pinned rNet dependency?

- Is an absent provider a supported configuration? Are model-target selection and provider implementation dependencies confined to the intended boundary?
- Do retries, Retry-After, stalled headers/bodies, token counting, image loading, and backoff share a cumulative deadline? Are aborts distinguished from retryable errors?
- Do refusals, incomplete responses, malformed output, and billed errors retain usage without exposing response bodies or credentials in errors?
- Are actual served tier, unknown/missing tier, cached tokens, reasoning tokens, and image estimates represented consistently? Check pricing against repository-pinned assumptions; any current-price assertion requires current official evidence.
- Are bytes/MIME/magic, dimensions, attachment counts, decoding limits, and element-only access enforced before expensive work? Origin artifacts must never become model attachments.

**Changed files:**

```text
.env.example
.github/workflows/ci.yml
apps/host/src/api/generated/openapi.ts
apps/server/package.json
apps/server/src/blobs/r2.ts
apps/server/src/blobs/types.ts
apps/server/src/config.ts
apps/server/src/errors.ts
apps/server/src/inference/config.ts
apps/server/src/inference/connector-registry.ts
apps/server/src/inference/fake-connector.ts
apps/server/src/inference/image.ts
apps/server/src/inference/model-connector.ts
apps/server/src/inference/openai/config.ts
apps/server/src/inference/openai/connector.ts
apps/server/src/inference/openai/image-tokens.ts
apps/server/src/inference/openai/rate-card.ts
apps/server/src/inference/openai/responses-api.ts
apps/server/src/inference/output-validator.ts
apps/server/src/inference/structured-output-schema.ts
apps/server/test/blobs.test.ts
apps/server/test/fixtures/push-images.ts
apps/server/test/inference-boundary.test.ts
apps/server/test/inference-config.test.ts
apps/server/test/inference.test.ts
apps/server/test/openai-connector.test.ts
apps/server/test/output-validator.test.ts
apps/server/test/push-contract.test.ts
apps/server/test/store.integration.test.ts
bun.lock
packages/store-contract/src/index.ts
packages/store-contract/src/push.ts
scripts/generate-host-openapi.ts
tsconfig.json
```

### #36 — concept 2: M3: execute and meter scoped push tasks

Runs asynchronous element, object, and Vibe tasks with permission checks, bounded context, strict output/reference validation, per-operation metering, and row-locked inferred writes. Adds the task catalog, status endpoints, inferred-revision migration, generated clients, and integration coverage.

**Review focus:** Prioritize authorization, acceptance/workset consistency, durable-entry preservation, concurrent writes, metering before writes, failure settlement, and process-local status visibility. Read authored code before generated migration snapshots and client output.

- PR: [https://github.com/2DM-technologies/rhizome/pull/36](https://github.com/2DM-technologies/rhizome/pull/36)
- Branch: `m3/review-02-push-engine`
- Base: `00b4c57df459768616e3852b1d30b1b8b710cb7a` (`m3/review-01-foundations`)
- Code head: `d2e95b5c8d89c5a69a0bdc148883f37bfe679371`
- Incremental scope: 69 files changed, 10648 insertions(+), 91 deletions(-)

```bash
git fetch origin m3/review-02-push-engine
git diff --stat 00b4c57df459768616e3852b1d30b1b8b710cb7a...d2e95b5c8d89c5a69a0bdc148883f37bfe679371
git diff 00b4c57df459768616e3852b1d30b1b8b710cb7a...d2e95b5c8d89c5a69a0bdc148883f37bfe679371 -- path/to/assigned/file
```

**Questions to trace:**

- Are element/object selections constrained to the requested level, and Vibe-level selection rejected? Are task names consistently kebab-case and public status/result shapes closed?
- Do result variants, removal-only outcomes, preserved entries, nullable terminal results, pointers, and serializers agree with generated clients?
- Do model defaults, migration columns/foreign keys, inferred revisions, and operation-linked Vibe revisions line up? Does app construction preserve keyless startup?
- Does generation faithfully include all seven installed task manifests, with the same level/name identity and schema vocabulary as the pinned rNet dependency?

- Is authorization checked before task/workset/provider information can leak? Can shared elements or objects grant unintended access? A push-only actor can invoke but cannot necessarily read/poll results.
- Are selections deduplicated and pinned at acceptance, with the same workset used by outcomes, status, limits, and writes?
- Does each write touch only its own non-durable `rhizome:{task}` key, preserving other writers and concurrent user updates? Are same-key durable entries rechecked under the write lock?
- Is billable usage recorded before output/write failure can lose it? Do partial successes, removal-only runs, aborts, invalid terminal results, retries, and boot interruption close the operation/meter honestly?
- Are waiting/running/error states scoped to readable records and Vibes, and stripped of private requests, resolved selections, and usage? Test overlapping runs and retries, including process-local bookkeeping.
- Do `startPush`'s orb `afterCommit` callback and membership-triggered `refreshVibeOrb` interact correctly with finalization, authorization, HTTP error behavior, and limits?

- Are task names unique by `(level, name)`, task manifests valid, and level-specific hooks/element kinds constrained correctly?
- Are record-intrinsic context, field-pointer discovery/escaping, exclusions, depth/byte limits, token limits, and dropped-context accounting consistent? Object/element inference must not accidentally gain whole-Vibe context or origins.
- Are user/source text and prompts treated as data boundaries, and are malformed/duplicate/missing/unknown response refs rejected as a batch rather than written partially by accident?
- Do null output, preserved durable output, and independently rederived summary behavior match the writer contract? Does summary title validation allow useful titles while rejecting invalid ones?
- Do each inferred view's discriminator and pointers match observed record data? Are homogeneous rule paths and mixed-content model paths both valid, including `tweetfeed` selection?

**Changed files:**

```text
README.md
apps/host/src/api/generated/openapi.ts
apps/host/src/api/generated/push-tasks.ts
apps/host/test/push-manifests.test.ts
apps/server/drizzle/0007_long_silver_surfer.sql
apps/server/drizzle/meta/0007_snapshot.json
apps/server/drizzle/meta/_journal.json
apps/server/src/app.ts
apps/server/src/db/models/media-element.ts
apps/server/src/db/models/media-object.ts
apps/server/src/db/models/vibe-revision.ts
apps/server/src/db/seedDb.ts
apps/server/src/index.ts
apps/server/src/metering/meter-ledger.ts
apps/server/src/push/chunking.ts
apps/server/src/push/context.ts
apps/server/src/push/inference-status.ts
apps/server/src/push/installed-tasks.ts
apps/server/src/push/limits.ts
apps/server/src/push/markdown.d.ts
apps/server/src/push/output-json.ts
apps/server/src/push/push-service.ts
apps/server/src/push/task-catalog.ts
apps/server/src/push/task-inference-status.ts
apps/server/src/push/tasks/element/describe-media/PROMPT.md
apps/server/src/push/tasks/element/describe-media/manifest.ts
apps/server/src/push/tasks/element/describe-media/output.json
apps/server/src/push/tasks/object/display-name/PROMPT.md
apps/server/src/push/tasks/object/display-name/manifest.ts
apps/server/src/push/tasks/object/display-name/output.json
apps/server/src/push/tasks/object/search-keywords/PROMPT.md
apps/server/src/push/tasks/object/search-keywords/manifest.ts
apps/server/src/push/tasks/object/search-keywords/output.json
apps/server/src/push/tasks/vibe/summarize/PROMPT.md
apps/server/src/push/tasks/vibe/summarize/manifest.ts
apps/server/src/push/tasks/vibe/summarize/output.json
apps/server/src/push/tasks/vibe/vibe-view/PROMPT.md
apps/server/src/push/tasks/vibe/vibe-view/manifest.ts
apps/server/src/push/tasks/vibe/vibe-view/output.json
apps/server/src/push/tasks/vibe/vibe-view/rules.ts
apps/server/src/routes/media-objects.ts
apps/server/src/routes/push-tasks.ts
apps/server/src/routes/task-inference-status.ts
apps/server/src/routes/vibes.ts
apps/server/src/serializers/operation-serializer.ts
apps/server/src/serializers/vibe-serializer.ts
apps/server/src/services/inferred-writer.ts
apps/server/src/services/media-object-service.ts
apps/server/src/services/operation-service.ts
apps/server/src/services/operation-sweep.ts
apps/server/src/services/vibe-service.ts
apps/server/src/services/vibe-snapshot.ts
apps/server/test/image-attachments.test.ts
apps/server/test/media-element-serializer.test.ts
apps/server/test/operation-serializer.test.ts
apps/server/test/operation-service.integration.test.ts
apps/server/test/operation-sweep.test.ts
apps/server/test/push-tasks.test.ts
apps/server/test/push.integration.test.ts
apps/server/test/rnet-semantics.test.ts
apps/server/test/task-inference-status.test.ts
apps/server/test/vibe-view.test.ts
impl/CONFORMANCE.md
impl/IMPLEMENTATION_PLAN.md
impl/concepts/push-pipeline.md
packages/store-contract/src/index.ts
packages/store-contract/src/inference-status.ts
packages/store-contract/src/task-inference-status.ts
scripts/generate-host-openapi.ts
```

### #37 — concept 3: M3: enrich confirmed imports through source-declared task graphs

Source manifests declare their enrichment graph. Confirmation schedules tasks after import commit; imports into existing Vibes enrich additions and retain the owner's title. New imports prefer source titles with summary fallback. Includes graph compilation, failure settlement, source fixtures, and the X 25-post eligibility cap.

**Review focus:** Review confirm-once behavior, empty graphs, denied/cancelled/replayed imports, additions-only scope, dependency completion, title precedence, and unavailable providers.

- PR: [https://github.com/2DM-technologies/rhizome/pull/37](https://github.com/2DM-technologies/rhizome/pull/37)
- Branch: `m3/review-03-import-enrichment`
- Base: `d2e95b5c8d89c5a69a0bdc148883f37bfe679371` (`m3/review-02-push-engine`)
- Code head: `03ddf7321a6c81fcf9a3079ff75e2920365587c2`
- Incremental scope: 47 files changed, 2076 insertions(+), 63 deletions(-)

```bash
git fetch origin m3/review-03-import-enrichment
git diff --stat d2e95b5c8d89c5a69a0bdc148883f37bfe679371...03ddf7321a6c81fcf9a3079ff75e2920365587c2
git diff d2e95b5c8d89c5a69a0bdc148883f37bfe679371...03ddf7321a6c81fcf9a3079ff75e2920365587c2 -- path/to/assigned/file
```

**Questions to trace:**

- Does boot reject unknown tasks, duplicate nodes, missing dependencies, and cycles? Does stable topological order preserve the declared graph rather than hard-code task ordering?
- Do eligible ready nodes overlap, and do settled failures unblock descendants without inventing successful results? Are context and operations accepted after dependency settlement?
- Does work start only after successful confirmation, never on preview/cancel/rejected VERIFY, and only once on replay? Existing-Vibe imports with no additions must not run enrichment.
- Do existing-Vibe imports select only added objects/eligible elements, run whole-Vibe tasks where intended, and preserve the owner's title? Are source-captured titles preferred and summary fallback naming correctly scoped to new destinations?
- Do keyless imports and empty transaction-source graphs remain usable? Does scope/selection failure in one task allow later tasks to settle coherently?
- Does the host navigate only after the destination exists and preserve reviewed-input meaning? Does history recreate import UI safely under the new window-unmount policy?
- Does the X latest-25 cap count eligible posts after exclusions, with deterministic ordering and matching VERIFY counts? Are source-specific behaviors kept within the source skill?

**Changed files:**

```text
apps/host/e2e/support/syntheticSourceSkills.ts
apps/host/test/fileCapture.test.ts
apps/ingest/connected-sources/catalog.test.ts
apps/ingest/file-sources/catalog.test.ts
apps/ingest/public-sources/catalog.test.ts
apps/ingest/skills/arena/SKILL.md
apps/ingest/skills/arena/arena.test.ts
apps/ingest/skills/arena/e2e/support/mockArenaSkill.ts
apps/ingest/skills/arena/manifest.ts
apps/ingest/skills/arena/scripts/parse-arena.ts
apps/ingest/skills/arena/source.test.ts
apps/ingest/skills/arena/source.ts
apps/ingest/skills/transactions/ofx/manifest.ts
apps/ingest/skills/transactions/simplefin/manifest.ts
apps/ingest/skills/transactions/simplefin/source.test.ts
apps/ingest/skills/x/SKILL.md
apps/ingest/skills/x/definition.ts
apps/ingest/skills/x/oauth/e2e/m2-x-oauth.e2e.ts
apps/ingest/skills/x/oauth/manifest.ts
apps/ingest/skills/x/oauth/source.test.ts
apps/ingest/skills/x/tweet-candidates.test.ts
apps/ingest/source-skills/import-push-pipelines.ts
apps/ingest/source-skills/manifest-catalog.test.ts
apps/ingest/source-skills/manifest-catalog.ts
apps/ingest/src/public-remote-source-catalog.ts
apps/server/src/app.ts
apps/server/src/push/import-push-pipeline.ts
apps/server/src/push/push-service.ts
apps/server/src/routes/imports.ts
apps/server/src/routes/vibes.ts
apps/server/src/services/import-service.ts
apps/server/src/services/vibe-service.ts
apps/server/test/fixtures/import-push.ts
apps/server/test/ingestion-source-service.test.ts
apps/server/test/openapi.test.ts
apps/server/test/push-tasks.test.ts
apps/server/test/push.integration.test.ts
apps/server/test/source-connection-service.test.ts
apps/server/test/source-credential-service.test.ts
apps/server/test/store.integration.test.ts
impl/concepts/pinterest-import.md
impl/concepts/push-pipeline.md
impl/concepts/strava-import.md
impl/concepts/x-import.md
packages/store-contract/src/index.ts
packages/store-contract/src/source-skills.ts
packages/store-contract/test/contracts.test.ts
```

### #38 — concept 5: M3: infer object orb identities and compose Vibe recipes

Adds reusable object orb identities and shared version-3 Vibe recipes. Vibe appearance is composed deterministically from distinct saved object identities; membership changes and manual identity pushes refresh the derived recipe. Extends import graphs with the independent orb branch.

**Review focus:** Review normalization, deterministic seeds, distinct-member weighting, empty/durable identities, rules-only composition, membership refresh, and finalization/meter attribution. Older orb concept prose contains known superseded design claims; use the handoff's current product decisions.

- PR: [https://github.com/2DM-technologies/rhizome/pull/38](https://github.com/2DM-technologies/rhizome/pull/38)
- Branch: `m3/review-05-orb-identities`
- Base: `03ddf7321a6c81fcf9a3079ff75e2920365587c2` (`m3/review-03-import-enrichment`)
- Code head: `907dcb7a07500ca0ed431fd0df32ebe794709511`
- Incremental scope: 23 files changed, 1724 insertions(+), 68 deletions(-)

```bash
git fetch origin m3/review-05-orb-identities
git diff --stat 03ddf7321a6c81fcf9a3079ff75e2920365587c2...907dcb7a07500ca0ed431fd0df32ebe794709511
git diff 03ddf7321a6c81fcf9a3079ff75e2920365587c2...907dcb7a07500ca0ed431fd0df32ebe794709511 -- path/to/assigned/file
```

**Questions to trace:**

- Are object identity version 1 and Vibe recipe version 3 kept distinct? Do validation, normalization, render-time decoding, and task output schemas agree on bounds and required fields?
- Is each distinct object counted once, with explicit object weights and order-independent aggregation? Do malformed/missing identities, duplicated placements, palette stop weights, and empty contributions behave deterministically?
- Does circular hue handling avoid cancellation at red's wraparound or muddy averages? Do neutral/white/black backgrounds improperly dominate chromatic families? Are numeric edge cases bounded?
- Does deterministic `vibe-orb` composition use saved object identities without blob reads or another semantic inference call? Is its stable seed independent of member order?
- Do the import graph, manual identity push callback, and add/remove-member paths refresh the right Vibe while preserving durable entries, revisions, operation attribution, and declared limits?

**Changed files:**

```text
apps/host/src/api/generated/push-tasks.ts
apps/ingest/source-skills/import-push-pipelines.ts
apps/server/src/push/installed-tasks.ts
apps/server/src/push/push-service.ts
apps/server/src/push/task-catalog.ts
apps/server/src/push/tasks/object/orb-identity/PROMPT.md
apps/server/src/push/tasks/object/orb-identity/manifest.ts
apps/server/src/push/tasks/object/orb-identity/output.json
apps/server/src/push/tasks/vibe/vibe-orb/PROMPT.md
apps/server/src/push/tasks/vibe/vibe-orb/manifest.ts
apps/server/src/push/tasks/vibe/vibe-orb/output.json
apps/server/src/push/tasks/vibe/vibe-orb/palette.ts
apps/server/src/routes/vibes.ts
apps/server/test/push-tasks.test.ts
apps/server/test/push.integration.test.ts
apps/server/test/vibe-orb.test.ts
impl/CONFORMANCE.md
impl/IMPLEMENTATION_PLAN.md
impl/concepts/push-pipeline.md
impl/concepts/vibe-orb.md
impl/speculative/vibe-orb.md
packages/store-contract/package.json
packages/store-contract/src/orb.ts
```

### #39 — concept 6: M3: render glass orbs with bounded live resources and raster caching

Adds the shared WebGL/raster painter, persistent raster cache, procedural fallback, and playground. Small live icons pool at most two idle painters, delay hover activation, cap frame rate and pixel ratio, and pause offscreen. Includes standalone renderer browser coverage; desktop integration tests land with the desktop PR.

**Review focus:** Review resource ownership, cancellation, pooled canvas reuse, context loss, cache invalidation/eviction, animation timing, reduced motion, and appearance parity. Investigate the original branch's Linux keyboard-blur/settling test failure.

- PR: [https://github.com/2DM-technologies/rhizome/pull/39](https://github.com/2DM-technologies/rhizome/pull/39)
- Branch: `m3/review-06-orb-rendering`
- Base: `907dcb7a07500ca0ed431fd0df32ebe794709511` (`m3/review-05-orb-identities`)
- Code head: `66e35d4665a51fa4dd74ab5f19f59f33a0bdbeae`
- Incremental scope: 16 files changed, 2716 insertions(+), 1 deletion(-)

```bash
git fetch origin m3/review-06-orb-rendering
git diff --stat 907dcb7a07500ca0ed431fd0df32ebe794709511...66e35d4665a51fa4dd74ab5f19f59f33a0bdbeae
git diff 907dcb7a07500ca0ed431fd0df32ebe794709511...66e35d4665a51fa4dd74ab5f19f59f33a0bdbeae -- path/to/assigned/file
```

**Questions to trace:**

- Can StrictMode, Activity hide/reveal, size-class changes, context loss/restoration, failed initialization, HMR, pagehide, or destruction leave duplicate observers, listeners, RAFs, timers, or programs?
- Is the idle pool limited to two painters, inert while detached, expired after 30 seconds, and protected against reuse of lost contexts? Does same-size reuse avoid reallocation through a detached 1×1 buffer?
- Do numeric sizes <=48 use 30 FPS and DPR <=1.5 while other live renderers use their defaults? Does an event burst draw at most once per frame? Are initial sizing and dock-scale transforms handled from layout size?
- Do identical normalized recipes avoid transitions, settled recipes stop interpolating arrays/uploading unchanged uniforms, and shader motion retain real-time speed? Check slow/stalled clocks as well as the existing 120/144/240 Hz simulations.
- Does interaction energy settle after blur/leave within intended wall-clock behavior on slow CI GPUs? Investigate the known CI failure, including the 50ms delta clamp in `renderer.ts:729`, before deciding whether the implementation or test expectation is wrong. That clamp is a lead, not a confirmed diagnosis.
- Do cached PNGs match the still shader, have transparent edges, deduplicate raster work, survive storage/WebGL failure, and release obsolete Blob URLs? Do reduced motion and loading/CSS fallbacks remain visible without invisible live work?

**Changed files:**

```text
apps/host/e2e/orb-frame-timing.e2e.ts
apps/host/e2e/orb-performance.e2e.ts
apps/host/e2e/orb-raster.e2e.ts
apps/host/e2e/vibe-orb.e2e.ts
apps/host/src/App.tsx
apps/host/src/orb/OrbFallback.tsx
apps/host/src/orb/ProceduralVibeOrb.tsx
apps/host/src/orb/RasterVibeOrb.tsx
apps/host/src/orb/VibeOrbPlayground.tsx
apps/host/src/orb/raster.ts
apps/host/src/orb/rasterCache.ts
apps/host/src/orb/recipe.ts
apps/host/src/orb/renderer.ts
apps/host/src/orb/vibeRecipe.ts
apps/host/src/styles/index.css
apps/host/test/vibeOrb.test.tsx
```

### #40 — concept 4: M3: show inferred views, task progress, and tweet feeds

Adds push controls and polling, inferred object/Vibe views, live status/error skeletons, inline Vibe titles, import confirmation navigation, and tweetfeed media with safe outbound links. Includes the visual primitives those views need and browser coverage against the pre-desktop shell.

**Review focus:** Review polling cleanup, retained drafts during writes, view pointers/discriminators, title permissions, import navigation, media loading, keyboard interaction, and safe outbound links. The hero orb consumes the preceding renderer PR.

- PR: [https://github.com/2DM-technologies/rhizome/pull/40](https://github.com/2DM-technologies/rhizome/pull/40)
- Branch: `m3/review-04-inferred-views`
- Base: `66e35d4665a51fa4dd74ab5f19f59f33a0bdbeae` (`m3/review-06-orb-rendering`)
- Code head: `c93a8c841f0957c0a65a5a4782df9516c225e81e`
- Incremental scope: 48 files changed, 4055 insertions(+), 691 deletions(-)

```bash
git fetch origin m3/review-04-inferred-views
git diff --stat 66e35d4665a51fa4dd74ab5f19f59f33a0bdbeae...c93a8c841f0957c0a65a5a4782df9516c225e81e
git diff 66e35d4665a51fa4dd74ab5f19f59f33a0bdbeae...c93a8c841f0957c0a65a5a4782df9516c225e81e -- path/to/assigned/file
```

**Questions to trace:**

- Are terminal written/preserved/skipped results invalidated at the correct object/element/Vibe/catalog keys, including partial failures and removal-only writes?
- Do polling effects stop when surfaces unmount and resume safely on recreation? Can late results or stale operation IDs update the wrong page?
- Are waiting/running/error/idle states and successful retries represented correctly while existing inferred content remains visible? Are skeleton animations and reduced-motion states consistent?
- Do inferred view pointers use safe resolution and correct formatting for missing/heterogeneous values? Are object links and media fallback routes preserved?
- Does title editing preserve newer input across a pending save, handle errors/cancel/empty input, and refresh all labels? Losing a draft on window navigation is explicitly accepted; losing it within a still-mounted editing interaction is not.
- Do controls reflect permissions and provider availability without relying on the client to enforce server authorization?

- Is visible text preserved while only safe HTTP(S) destinations become links? Are credentials, malformed entities, punctuation, and balanced URL parentheses handled safely?
- Is chronological order deterministic for ties and invalid/missing dates? Are non-tweet/mixed Vibes routed to an appropriate inferred view?
- Do media layout, loading, playback, viewport observation, and cleanup work on desktop/mobile and after navigating away? Are unloaded/invalid/empty media references recoverable?
- Are action buttons, accessible names, keyboard focus, and tooltips usable without covering controls or producing accidental navigation?

**Changed files:**

```text
apps/host/e2e/automatic-enrichment-refresh.e2e.ts
apps/host/e2e/fast-task-completion.e2e.ts
apps/host/e2e/fixtures/tweetfeed.webm
apps/host/e2e/imageboard-documents.e2e.ts
apps/host/e2e/inference-status.e2e.ts
apps/host/e2e/m1-host.e2e.ts
apps/host/e2e/m2-import-launcher.e2e.ts
apps/host/e2e/m2-import.e2e.ts
apps/host/e2e/m2-source-oauth.e2e.ts
apps/host/e2e/m2-source-skills.e2e.ts
apps/host/e2e/m3-push.e2e.ts
apps/host/e2e/support/mockStore.ts
apps/host/e2e/support/reviewedFileSkillConformance.ts
apps/host/e2e/tweetfeed.e2e.ts
apps/host/e2e/vibe-overview.e2e.ts
apps/host/src/assets/brand/vibes-mark.svg
apps/host/src/mediaObjectDisplayName.ts
apps/host/src/queries/index.ts
apps/host/src/queries/inferenceStatus.ts
apps/host/src/queries/push.ts
apps/host/src/queries/taskInferenceStatus.ts
apps/host/src/styles/index.css
apps/host/src/styles/tokens.css
apps/host/src/surfaces/ImportPanel.tsx
apps/host/src/surfaces/ImportSurface.tsx
apps/host/src/surfaces/InferredBlock.tsx
apps/host/src/surfaces/InferredVibeView.tsx
apps/host/src/surfaces/MediaObjectEntry.tsx
apps/host/src/surfaces/ObjectSurface.tsx
apps/host/src/surfaces/PushControl.tsx
apps/host/src/surfaces/TweetFeed.tsx
apps/host/src/surfaces/VibeOverview.tsx
apps/host/src/surfaces/VibeSurface.tsx
apps/host/src/surfaces/VibesSurface.tsx
apps/host/src/surfaces/provisional.tsx
apps/host/src/surfaces/tweetfeed.ts
apps/host/src/ui/StartVibeGlow.tsx
apps/host/src/ui/SurfaceHeader.tsx
apps/host/src/ui/icons.tsx
apps/host/src/ui/useNearViewport.ts
apps/host/test/mediaObjectDisplayName.test.ts
apps/host/test/mediaObjects.test.ts
apps/host/test/push-views.test.tsx
apps/host/test/push.test.ts
apps/host/test/tweetfeed.test.ts
apps/ingest/skills/arena/e2e/m2-arena.e2e.ts
apps/ingest/skills/transactions/simplefin/e2e/m2-simplefin.e2e.ts
apps/ingest/skills/x/oauth/e2e/m2-x-oauth.e2e.ts
```

### #41 — concept 7: M3: retain the desktop and focus page windows in the shell

Adds desktop cards, account totals, dock pins and navigation, theme/assets, and the final shell integration. React Activity retains the visited desktop behind a page window while pausing effects; only the focused page window mounts. Completes hover/raster integration and end-to-end browser coverage.

**Review focus:** Preserve the user's desktop-retention decision. Review first-visit/deep-link behavior, scroll retention, effect cleanup, focused-window mounting, Home/back/maximize behavior, pin persistence, theme contrast, and account-total authorization.

- PR: [https://github.com/2DM-technologies/rhizome/pull/41](https://github.com/2DM-technologies/rhizome/pull/41)
- Branch: `m3/review-07-desktop-shell`
- Base: `c93a8c841f0957c0a65a5a4782df9516c225e81e` (`m3/review-04-inferred-views`)
- Code head: `17d3a18b928b05feedebf7fee0f3041791a01000`
- Incremental scope: 100 files changed, 4739 insertions(+), 723 deletions(-)

```bash
git fetch origin m3/review-07-desktop-shell
git diff --stat c93a8c841f0957c0a65a5a4782df9516c225e81e...17d3a18b928b05feedebf7fee0f3041791a01000
git diff c93a8c841f0957c0a65a5a4782df9516c225e81e...17d3a18b928b05feedebf7fee0f3041791a01000 -- path/to/assigned/file
```

**Questions to trace:**

- Is the focused route the only mounted window, even with `keepCurrentOpen` metadata, and are all window trees absent on Home? Do history, pinned/recent shortcuts, deep links, and exact window mode still reopen correctly?
- Does Home preserve its own DOM and scroll after first visit using React Activity while pausing effects and clearing live hover state behind a window? An initial deep link should not eagerly prepare an unseen desktop.
- Are route/store updates coherent in the same committed frame, especially true close versus Home toggle, to avoid blank frames or stale focus?
- Do Escape priority, title editing, launcher dismissal, active dock position, pin persistence/storage events, deleted Vibes, hydration, and recency limits behave correctly?
- Are hover delays canceled on pointer exit while keyboard focus/active-square animation remains immediate? Does Activity cleanup release thumbnail fetch effects, minute clocks, subscriptions, and live canvases?
- Do account totals enforce owner identity, safely convert database aggregates, and update without expensive duplicate work?

- Does initial theme avoid a flash, follow system changes until the user chooses a session override, and preserve mounted window drafts/focus across theme updates?
- Are inverted dock colors, light/dark backgrounds, text contrast, focus rings, reduced motion, skeleton animation bounds, and layout dimensions coherent across primitives and Storybook?
- Does the Vibes mark use the shared SVG correctly in production (`?no-inline` plus external `<use>`), with accessible parent names and unique IDs for other masks?
- Are font/image assets appropriately sized/loaded, and do layout or decorative CSS effects add avoidable continuous work? Separate measured performance issues from stylistic preferences.
- Do app wrappers preserve shell identity, and do new assets/playground routes bundle correctly without unexpected provider/server imports?

- Do documentation claims match the final seven kebab-case tasks, object identity version 1/Vibe recipe version 3, deterministic Vibe composition, raster caching, and retained desktop policy? The known stale passages below require reconciliation.
- Are M5/M7 gaps disclosed accurately without describing them as implemented? Do Strava/Pinterest/speculative material remain roadmap context rather than accidental shipped-feature claims?
- Does the pinned sibling rNet commit satisfy the task-name and inferred-record schemas? Do the lockfile, `sharp`, package exports, TypeScript imports, and generated host contracts work in a clean checkout?
- Does CI use isolated databases, keyless fakes/stubs, and the same authored source that is reviewed? Are green historical totals distinguished from the failing current browser gate?
- Does the PR description describe the current full implementation, dependency graph, tests, and remaining limits rather than the earlier eleven-commit/five-task version?

**Changed files:**

```text
apps/host/.storybook/main.ts
apps/host/.storybook/preview.tsx
apps/host/e2e/desktop-home.e2e.ts
apps/host/e2e/desktop-loading.e2e.ts
apps/host/e2e/desktop-preview-retention.e2e.ts
apps/host/e2e/desktop-thumbnails.e2e.ts
apps/host/e2e/dock-layering.e2e.ts
apps/host/e2e/dock-pins.e2e.ts
apps/host/e2e/escape-window.e2e.ts
apps/host/e2e/m1-host.e2e.ts
apps/host/e2e/m2-import-launcher.e2e.ts
apps/host/e2e/m2-source-oauth.e2e.ts
apps/host/e2e/m3-push.e2e.ts
apps/host/e2e/orb-performance.e2e.ts
apps/host/e2e/orb-raster.e2e.ts
apps/host/e2e/support/mockStore.ts
apps/host/e2e/theme.e2e.ts
apps/host/e2e/tweetfeed.e2e.ts
apps/host/e2e/vibe-orb.e2e.ts
apps/host/e2e/window-mode.e2e.ts
apps/host/index.html
apps/host/src/App.tsx
apps/host/src/api/generated/openapi.ts
apps/host/src/assets/brand/wallpaper-dark.png
apps/host/src/assets/brand/wallpaper.png
apps/host/src/assets/fonts/ABCArealVariable.woff2
apps/host/src/assets/fonts/PublicoTextWeb-Roman.woff2
apps/host/src/assets/orbs/orb-vibes-96.png
apps/host/src/assets/profile/development-user.jpg
apps/host/src/queries/dashboard.ts
apps/host/src/queries/index.ts
apps/host/src/queries/payloadUrl.ts
apps/host/src/session/session.ts
apps/host/src/shell/DesktopHome.tsx
apps/host/src/shell/DesktopVibeCard.tsx
apps/host/src/shell/ShellLayout.tsx
apps/host/src/shell/SurfaceChrome.tsx
apps/host/src/shell/SurfaceLayer.tsx
apps/host/src/shell/dockOpenMotion.ts
apps/host/src/shell/dockPins.ts
apps/host/src/shell/focus.ts
apps/host/src/shell/search.ts
apps/host/src/shell/store.ts
apps/host/src/shell/surfaceMarks.ts
apps/host/src/shell/surfaces.ts
apps/host/src/styles/index.css
apps/host/src/styles/tokens.css
apps/host/src/surfaces/ObjectSurface.tsx
apps/host/src/surfaces/TweetFeed.tsx
apps/host/src/surfaces/VibeActionsMenu.tsx
apps/host/src/surfaces/VibeSurface.tsx
apps/host/src/surfaces/VibesSurface.tsx
apps/host/src/theme.tsx
apps/host/src/ui/Agent.stories.tsx
apps/host/src/ui/AgentSidebar.tsx
apps/host/src/ui/Button.tsx
apps/host/src/ui/CategoryTable.tsx
apps/host/src/ui/ChatMessage.tsx
apps/host/src/ui/Desktop.tsx
apps/host/src/ui/DmachineWindow.tsx
apps/host/src/ui/Dock.tsx
apps/host/src/ui/DockApp.tsx
apps/host/src/ui/ElementPreview.tsx
apps/host/src/ui/Foundations.stories.tsx
apps/host/src/ui/LauncherItem.tsx
apps/host/src/ui/LauncherPanel.tsx
apps/host/src/ui/ProgressBar.tsx
apps/host/src/ui/SearchField.tsx
apps/host/src/ui/SelectInput.tsx
apps/host/src/ui/Shell.stories.tsx
apps/host/src/ui/StartVibeGlow.tsx
apps/host/src/ui/TextArea.tsx
apps/host/src/ui/TextInput.tsx
apps/host/src/ui/ToolCallBlock.tsx
apps/host/src/ui/icons.tsx
apps/host/src/ui/useNearViewport.ts
apps/host/src/vibeRecency.ts
apps/host/test/shell-search.test.ts
apps/host/test/shell-store.test.ts
apps/host/vite.config.ts
apps/ingest/skills/arena/e2e/m2-arena.e2e.ts
apps/ingest/skills/x/oauth/e2e/m2-x-oauth.e2e.ts
apps/server/package.json
apps/server/src/app.ts
apps/server/src/blobs/element-thumbnails.ts
apps/server/src/routes/me.ts
apps/server/src/routes/media-elements.ts
apps/server/src/services/dashboard-stats-service.ts
apps/server/test/dashboard-stats-service.test.ts
apps/server/test/element-thumbnails.test.ts
apps/server/test/openapi.test.ts
apps/server/test/store.integration.test.ts
impl/concepts/design-tiers.md
impl/reviews/m3-pr-review-handoff.md
impl/speculative/sandboxing.md
impl/speculative/ui-component-elements.md
packages/store-contract/src/dashboard.ts
packages/store-contract/src/index.ts
packages/store-contract/test/contracts.test.ts
scripts/generate-host-openapi.ts
```

### #42 — concept 8: M3: overlap LLM batches with bounded process concurrency

Defaults to two complete object/element batches per operation and four logical LLM calls shared across the API process. Includes Vibe calls in the shared FIFO. The permit covers connector retries and usage recording. Batch preparation is lazy and bounded before advancing the iterator.

**Review focus:** Immutable call IDs; serialized usage/pricing snapshots; one batch's status cannot clear another; admission and ceiling checks after shared waits; fatal/wall stops and accounting/write drain before finalization. Verify that integration retains tombstones, invalid-string handling, safe logging, per-Vibe graph serialization, title guards, and Are.na limits from the repaired parent stack.

- PR: https://github.com/2DM-technologies/rhizome/pull/42
- Branch: `m3/parallel-batches`
- Base: `17d3a18b928b05feedebf7fee0f3041791a01000` (`m3/review-07-desktop-shell`)
- Code head: `82cf4446bde2618f6aa491a13bc5cb62bcebadde`
- Incremental scope: 9 files changed, 1240 insertions(+), 139 deletions(-)

```bash
git fetch origin m3/parallel-batches
git diff --stat 17d3a18b928b05feedebf7fee0f3041791a01000...82cf4446bde2618f6aa491a13bc5cb62bcebadde
git diff 17d3a18b928b05feedebf7fee0f3041791a01000...82cf4446bde2618f6aa491a13bc5cb62bcebadde -- path/to/assigned/file
```

**Questions to trace:**

- Do call indexes and record refs survive out-of-order completion without lost totals or duplicate writes?
- Do call/token stops let admitted calls finish, while fatal/wall stops suppress new writes and drain all started work?
- Does an unbilled or zero-call failure keep a null producer? Is activity cleared even when the finalizer fails?
- Can a cancelled shared wait leak a permit, exceed maxCalls, or buffer additional image batches?
- Does a failed pricing/persistence entry prevent a billed sibling from recording? Are both snapshots serialized?

**Changed files:**

```text
apps/server/src/app.ts
apps/server/src/metering/meter-ledger.ts
apps/server/src/push/concurrency.ts
apps/server/src/push/inference-status.ts
apps/server/src/push/push-service.ts
apps/server/test/push-concurrency.integration.test.ts
apps/server/test/push-concurrency.test.ts
apps/server/test/push.integration.test.ts
impl/concepts/push-pipeline.md
```

## Coordinator checklist

- Assign all eight PRs and reconcile cross-PR findings with one primary owner.
- Check current GitHub jobs on exact published heads; do not infer merge approval from one clean slice.
- Keep the remaining issues above visible, especially protocol/membership deferrals and stale canonical prose.
- Revalidate affected descendants after any repair. Preserve original #33 and #34 until their handling is explicitly decided.
