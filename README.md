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

Open `http://127.0.0.1:5173`. The explicit IPv4 loopback origin keeps local OAuth return URLs on
the same address that the development host actually binds.

The store requires object storage at startup, so `bun run dev:s3` runs a local S3 emulator with the four buckets already created, keeping its data in `.rhizome/s3`. The defaults in `.env.example` point at it. To run against real R2 instead, replace the endpoint and credentials and skip that step; `R2_FORCE_PATH_STYLE=true` is for emulators only.

`.env` lives at the repository root and is read from there by both apps, even though `bun --filter` runs each with its own working directory — the server passes `--env-file` and Vite sets `envDir`.

The development auth mode recognizes `Bearer dev:user` and `Bearer dev:user:other` for seeded owners and `Bearer dev:client:rbudget` for the seeded standard dMachine. Development credentials are rejected when `NODE_ENV=production`, including when the auth-mode variable is omitted.

## Credential key management

Local development generates a stable private `.rhizome/source-credential.key`; it does not depend
on the macOS Keychain or AWS. Production refuses raw active credential keys and requires:

- `RHIZOME_CREDENTIAL_KMS_KEY_ID`: a customer-managed symmetric `ENCRYPT_DECRYPT` KMS key.
- `RHIZOME_CREDENTIAL_KMS_HMAC_KEY_IDS`: comma-separated `HMAC_256` KMS keys, active first and
  retained keys after it for one-time-token replay detection. Mutable aliases are rejected: use
  immutable key ids or key ARNs. When rotating, prepend the new identifier and keep each prior
  HMAC key enabled and configured until every claim-ledger row and backup fingerprinted with it
  has expired or been purged under the deployment's retention policy.
- `AWS_REGION` and an IAM workload role through the AWS SDK's standard credential chain.

The runtime role needs `kms:GenerateDataKey` and `kms:Decrypt` on the encryption key, plus
`kms:GenerateMac` on the HMAC keys. New credentials use a fresh AES-256 data key and store only a
v3 envelope containing its KMS-wrapped copy and authenticated ciphertext. The row binding is
hashed before it enters KMS encryption context so owner and credential identifiers do not appear
in CloudTrail context fields. KMS key-material rotation under the same key id is transparent.
`RHIZOME_CREDENTIAL_LEGACY_KEYRING` is a migration-only v1/v2 read fallback and supplies overlapping
one-time-token fingerprints during a rolling local-to-KMS deployment; all instances must retain it
until that rollout is complete. It is never used for new production writes.

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

The server serves its OpenAPI 3.1 document at `/rnet/v0/openapi.json`. Contract ownership is split
deliberately:

- `@rnet/types` owns canonical rNet documents.
- `@rhizome/store-contract` owns Rhizome-specific JSON request and response schemas.
- `rhizomeRoute` owns paths, methods, authentication, statuses, headers, and media types.

The served document remains standalone for external clients. The in-repository
`openapi-typescript` output generates the path/operation wiring but aliases schema components back
to those two canonical packages, so it does not create a second structural copy of their types.
Run `bun run openapi:generate` after changing a route contract; `bun check` fails if the generated
host file is stale, a component has no canonical alias, or the document contains an unresolved
external schema reference.
