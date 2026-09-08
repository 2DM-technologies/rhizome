# Repository guidance

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
