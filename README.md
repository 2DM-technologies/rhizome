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
bun run dev
```

Configure the object-store endpoint, credentials, and buckets in `.env`; local S3 emulators should set `R2_FORCE_PATH_STYLE=true`. The development auth mode recognizes `Bearer dev:user` and `Bearer dev:user:other` for seeded owners and `Bearer dev:client:rbudget` for the seeded standard dMachine. Development credentials are rejected when `NODE_ENV=production`, including when the auth-mode variable is omitted.

Run all checks with:

```sh
bun check
```

## OpenAPI

The server serves its OpenAPI 3.1 document at `/rnet/v0/openapi.json`. The document is derived from the same `rhizomeRoute` request and response schemas used for runtime validation.

`bun check` verifies the document has no unresolved external schema references and that `openapi-typescript` can generate a typed client contract from it in memory. Frontend API types will be generated directly into `apps/host` when frontend implementation begins.
