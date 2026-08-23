# Rhizome

Rhizome is a new platform built on vibe-based computing. It gives people user-owned, dynamic Vibes that can move across media and connect safely to AI-powered applications and creative tools. rNet is the open protocol Rhizome uses at that boundary; it is infrastructure for the platform, not the definition of the product.

## Local development

Requirements: Bun 1.3.10+ and PostgreSQL 16+.

```sh
cp .env.example .env
createdb rhizome
bun install
bun run db:migrate
bun run dev
```

The development auth mode recognizes `Bearer dev:user` for the seeded owner and `Bearer dev:client:rbudget` for the seeded standard machine. Development credentials are rejected when `NODE_ENV=production`.

Run all checks with:

```sh
bun check
```
