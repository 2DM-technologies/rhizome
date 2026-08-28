# Host browser tests

The M1.5 browser lane runs the real Vite host against deterministic Store route mocks. It exercises
the generated OpenAPI client, TanStack Query, BrowserRouter, and persistent shell without sharing
the Postgres database or S3 emulator used by the server suites.

Install Chromium once, then run the lane from the repository root:

```sh
bun --filter @rhizome/host test:e2e:install
bun run test:e2e
```

Files use `*.e2e.ts` deliberately. Bun discovers `*.spec.ts`, so using Playwright's conventional
suffix would also load these files during `bun test`.

The lane covers canonical home navigation and launcher search in addition to deep links, retained
surfaces, Vibe CRUD and membership, user-property edits, and payload presentation.

## Remaining full-stack gate

The mocked lane is not the milestone's final host/Store proof. Add a separate live-Store project
using a dedicated migrated database, an ephemeral S3rver directory, and seeded dev identities
rather than the shared `rhizome_m1_test` database or persistent `.rhizome/s3` development
directory. Its M1.5 happy path starts from an existing seeded object and element: home → create and
rename a Vibe → add the seeded object → edit user properties → navigate away/back → reload and
observe persisted state and payload bytes → remove the object and delete the Vibe.

Host-authored object creation is deliberately outside this gate. M2 ingestion is the first host
flow that creates objects.
