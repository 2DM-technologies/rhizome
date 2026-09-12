# Strava source boundaries

Permitted input is the importing owner's uploaded CSV or account-export archive. Parsing is local,
deterministic, and bounded; it has no network, credential, OAuth, scraping, or API capability.
Referenced URLs are values only and are never fetched. An XML DTD or entity declaration is forbidden.

The complete uploaded bytes are one owner-only OriginArtifact, including private archive entries
the parser ignores. Origins are not elements, are not Vibe members, and are not model context.
Runtime candidates contain bounded activity facts, device laps, and computed splits, not GPS traces,
sensor streams, descriptions, photographs, friends, or social data. Only the platform assigns
ownership, provenance, record identities, source bindings, and eventual writes.

Provider parsing, input dialect recognition, original association, SI conversion, and source VERIFY
live in this directory. ZIP safety lives in `apps/ingest/source-skills/zip.ts`. The skill imports no
other provider implementation and no host code. The only installation change outside those boundaries
is the file capability entry in `apps/ingest/src/source-skill-catalog.ts`.

Unknown formats and absent originals have visible coverage statuses; malformed supported data and
exceeded budgets fail closed. The parser does not silently omit a valid running row, infer a timezone,
make official race claims, or derive individual mile times by dividing an average pace.

Newer exports use the generic owner-reviewed file-reselection operation. A parser never overwrites
source blocks, chooses another owner's object, copies model output, or carries owner annotations.
The store reviews and atomically applies these changes with its own authorization and history rules.
