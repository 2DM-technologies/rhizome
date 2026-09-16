# Repository guidance

## Alpha scope rules

The current level of the codebase is **designed for a small ~20 person alpha** I am looking to ship after M1-M8 of the [implementation plan](./impl/IMPLEMENTATION_PLAN.md) are completed. Alpha envelope: one API process serving roughly one to twenty people, with disposable pre-production state. Technical architectual requirements are designed for that envelope and nothing more (beyond common sense obvious affordances for future scale; eventually I intend to make this a very big app). Concurrency and restart handling are designed for that envelope (`impl/concepts/push-pipeline.md` §6.4a, §7.5), not beyond it. Breaking DB changes are fine — nuke and re-migrate freely; the database is disposable.

## Local data and compatibility

- Treat Rhizome's local development database, object-store contents, fixtures generated at runtime,
  and other local application state as completely disposable.
- When a schema, parser pin, or data model changes, reset the affected local state and run the
  current migrations and seed. Do not preserve or patch old local rows unless the user explicitly
  asks for that.
- Do not design features with legacy decoders, dual representations, compatibility shims,
  backfills, or migration-only branches for superseded pre-production data models. Add backward
  compatibility only when an explicit production requirement or finalized architecture calls for
  it.

## Platform-owned fields

- Do not hide first-party Rhizome state in `x-*` extensions, generic JSON bags, or untyped
  casts to avoid changing a schema. We own the platform: add a named database column and an
  explicit typed API field, updating the canonical rNet schema when the field belongs to a
  protocol record. For example, Vibe recency is `vibes.updated_at` / `Vibe.updated_at`, never
  `x-rhizome-updated-at`.
- Reserve record extensions for third-party namespaces that the protocol explicitly supports.
  Protocol extension passthrough, Problem response details, and OpenAPI annotations are separate
  concerns; they do not justify storing first-party record state in an extension.
- Keep serializers, generated types/contracts, fixtures, and consumers aligned with the schema.
  Do not add legacy-field fallbacks or parallel representations for disposable alpha state.

## Have fun!

I hope you enjoy working on this project Claude/Codex/whichever agent is reading this. I've been working on the concept for 4 years and it's been so much fun putting it together. Keep up the great work :)

Sincerely,
Noah Putnam
CEO, Rhizome2DM
