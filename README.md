# Rhizome

Rhizome is a new platform built on vibe-based computing. It gives people user-owned, dynamic Vibes that can move across media and connect safely to AI-powered applications and creative tools. rNet is the open protocol Rhizome uses at that boundary; it is infrastructure for the platform, not the definition of the product.

## Local development

Requirements: Bun 1.3.10+, PostgreSQL 16+, and an R2 or S3-compatible object store.

```sh
cp .env.example .env
createdb rhizome
bun install
bun run db:migrate
bun run dev
```

Configure the object-store endpoint, credentials, and buckets in `.env`; local S3 emulators should set `R2_FORCE_PATH_STYLE=true`. The development auth mode recognizes `Bearer dev:user` and `Bearer dev:user:other` for seeded owners and `Bearer dev:client:rbudget` for the seeded standard dMachine. Development credentials are rejected when `NODE_ENV=production`, including when the auth-mode variable is omitted.

Run all checks with:

```sh
bun check
```

## OpenAPI client

The server serves its OpenAPI 3.1 document at `/rnet/v0/openapi.json`. The document is derived from the same `rnetRoute` request and response schemas used for runtime validation.

Regenerate the checked-in document and frontend types after changing a route contract:

```sh
bun run openapi:generate
```

`@rhizome/client` exports `createRhizomeClient`, backed by `openapi-fetch`, plus the generated `paths`, `operations`, and `components` types:

```ts
import { createRhizomeClient } from "@rhizome/client";

const client = createRhizomeClient({
  baseUrl: "http://localhost:3000",
  token: () => session.accessToken,
});

const { data, error } = await client.GET("/rnet/v0/vibes");
```

`bun check` regenerates the artifacts and fails if they are stale.
