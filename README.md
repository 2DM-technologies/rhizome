# Rhizome

Rhizome is a new platform built on vibe-based computing. It gives people user-owned, dynamic Vibes that can move across media and connect safely to AI-powered applications and creative tools. rNet is the open protocol Rhizome uses at that boundary; it is infrastructure for the platform, not the definition of the product.

## Local development

Requirements: Bun 1.3.10+, PostgreSQL 16+, and an R2 or S3-compatible object store.

```sh
cp .env.example .env
createdb rhizome
bun install
bun run db:migrate
bun run db:seed
bun run dev:s3   # in its own terminal; leave it running
bun run dev
```

The store requires object storage at startup, so `bun run dev:s3` runs a local S3 emulator with the four buckets already created, keeping its data in `.rhizome/s3`. The defaults in `.env.example` point at it. To run against real R2 instead, replace the endpoint and credentials and skip that step; `R2_FORCE_PATH_STYLE=true` is for emulators only.

`.env` lives at the repository root and is read from there by both apps, even though `bun --filter` runs each with its own working directory — the server passes `--env-file` and Vite sets `envDir`.

The development auth mode recognizes `Bearer dev:user` and `Bearer dev:user:other` for seeded owners and `Bearer dev:client:rbudget` for the seeded standard dMachine. Development credentials are rejected when `NODE_ENV=production`, including when the auth-mode variable is omitted.

Run all checks with:

```sh
bun check
```

## Host

`apps/host` is the Rhizome shell: the desktop, the dock, the agent sidebar, and the window chrome a
dMachine runs inside. It is a Vite + React SPA and is **not** a dMachine — it is the container.

The design system is implemented as a component library with a Storybook:

```sh
bun --filter @rhizome/host storybook
```

Components live in `apps/host/src/ui`, tokens in `apps/host/src/styles/tokens.css`. Both are
generated from the Figma file's `🪸 Design System` page; each component cites the Figma node id it
came from. Read `impl/concepts/design-tiers.md` before changing a colour — the token set inverts by
tier, and the `Tier` switch in the Storybook toolbar is how you check a component reads token names
rather than literals.

The frontend toolchain runs under Bun (`bunx --bun vite`, `bunx --bun storybook`) rather than the
`node` on your `PATH`: Vite 8 and Storybook 10 both require Node 20.19+, and the bin shebangs would
otherwise pick up whatever is installed.

## OpenAPI

The server serves its OpenAPI 3.1 document at `/rnet/v0/openapi.json`. The document is derived from the same `rhizomeRoute` request and response schemas used for runtime validation.

`bun check` verifies the document has no unresolved external schema references and that `openapi-typescript` can generate a typed client contract from it in memory. Frontend API types will be generated directly into `apps/host` when frontend implementation begins.
