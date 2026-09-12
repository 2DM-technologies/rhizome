# Browser test support

`@rhizome/test-support` owns the generic mocked Store, Playwright runtime, and reviewed-file
conformance harness used by the host and installed-source suites. Provider parsers, synthetic
exports, and adapters stay with their skills. Transaction-specific adapter utilities live with
`apps/ingest/skills/transactions/e2e`.

The harness accepts the source's candidate label and source-record count independently; excluded
rows and nonfinancial records do not inherit transaction-only assertions. The mock serves
owner-source lookup so the host can render existing-import update controls. Real-store suites
remain the authority for locking, authorization, reconciliation, and durable history semantics.

`src/generated/push-tasks.ts` is generated from the installed server task manifests alongside the
host's task inventory. Run `bun run openapi:generate`; `openapi:check` verifies both outputs. This
keeps tests independent of host implementation imports without a hand-maintained task list.
