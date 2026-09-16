# Strava export ingestion

**Status:** Approved roadmap addition, milestone **S1**. Implementation has not started.
The product scope and source boundary below guide the build; exact export dialects, numeric
field names, and file-size budgets must be established from representative exports first.

**Companion docs:** [implementation plan](../IMPLEMENTATION_PLAN.md),
[conformance status](../CONFORMANCE.md), and [push pipeline](../concepts/push-pipeline.md).

## 1. Product purpose

The first user is a runner training for her second marathon. She wants to revisit all her runs,
compare mile times, follow performance over time, and keep track of race results. This source
should provide the factual records that those experiences need.

S1 adds a registered rNet **`activity`** vocabulary and a committed, deterministic **Strava export
skill** at `apps/ingest/skills/strava/` that produces it.
Strava's recognized CSV export dialect is part of that skill. The earlier restriction on generic
CSV ingestion concerned an unbounded collection of unrelated bank dialects; it does not prohibit
a source-owned, fixture-backed parser for an identified export format.

The acquisition path is a user-supplied export. API credentials, OAuth, scraping, and automatic
Strava synchronization are outside this milestone. A dedicated running dMachine is a subsequent
consumer of these records; S1 does not require building that application.

## 2. Input and first usable scope

Accept a Strava account export archive containing its activity summary CSV and referenced
original activity files. Also accept the recognized summary CSV on its own, with an explicit
summary-only result. The same file-source manifest can advertise both inputs.

The summary file supplies the activity inventory and available per-activity facts. Original
files supply recorded laps and the distance/time evidence needed for mile splits. **CSV-only
import is an intermediate delivery, not completion of the mile-split requirement.**

Before implementation, inspect representative export headers, units, time representations,
archive paths, file formats, and compressed/expanded sizes. Begin original-file support with
the formats present in the runner's export; FIT, TCX, and GPX are the relevant candidates.
Record the supported format set in the skill rather than claiming to parse every original
format that Strava can retain. Include any nested compression in the same bounded contract.

Bind each original file unambiguously to its summary row using the recognized export's path or
identity metadata. Define consistency checks and documented tolerances for identifiers, start
times, and distance; a detail file must never silently supply another run's splits. Preserve
legitimate differences between recorded measurements and exported processed summaries with their
respective provenance. Ambiguous or conflicting associations fail validation.

Import every supported running activity in the supplied snapshot, including running variants,
indoor runs, and manually entered runs where the export identifies them. Account for other
sports explicitly in VERIFY. Missing detail files or unavailable distance samples do not erase
a valid summary record: preview reports which runs have summaries, recorded laps, or computed
splits. Malformed data is a reported failure, never silently treated as missing data.

Photos, social records, and route-map presentation can follow after the running records work.
If the whole archive is uploaded, its complete bytes remain in the owner-only OriginArtifact,
including entries the parser does not consume. No referenced URL is fetched during parsing.

## 3. Records and measurements

Use one `activity` MediaObject per recorded physical exercise session, with the Strava activity
identifier retained as a string in `keys.strava_activity_id`. The store assigns Rhizome identity
and ownership. Register `activity` in rNet alongside `transaction`, `track`, and `tweet`.
Running is the first supported sport in this importer; the vocabulary is independent of the
provider and can also describe a ride, walk, or another recorded exercise session. A race run
is an activity with race facts, not a separate activity type.

### 3.1 Registered vocabulary and responsibility

The canonical `activity` definition belongs in `rnet/schemas/0.1/types/activity.json`, documented
in the rNet specification's registered core types section. It validates `source.properties` for
`type: "activity"`; it does not add a sixth MediaElement kind or change the MediaObject envelope.
The Strava skill imports the generated `ActivityProperties` type and canonical validator from
`@rnet/types` rather than maintaining a second definition of the common activity shape.

The shared vocabulary covers:

- Sport and available title/start-time facts, with explicit treatment of known instants versus
  local times whose timezone is unknown.
- Available distance, elapsed/timer/moving duration, and elevation measurements, with canonical
  units and clear missing-value semantics. Distance and GPS cannot be universally required:
  an indoor or manually recorded activity remains valid without them.
- Recorded laps and calculated distance splits as distinct structures, including distance,
  duration, timing basis, and measurement/calculation provenance. Split representation is not
  fixed to miles; S1's importer produces mile splits for the runner's use case.
- Explicit source-provided session/race classification when available. Owner-entered official
  race results remain `user` data and model interpretations remain `inferred` data under the
  existing protocol rules; registering this type does not close either of those property blocks.

Finalize required fields and nested shapes against the export fixtures before writing the
schema. The protocol owns the meanings, units, and interoperable representation. The importer
owns provider field mappings, supported formats, split-calculation implementation, and source
VERIFY. Rhizome owns runtime budgets and review behavior. Strava identifiers remain optional
external keys; a conformant activity from another source must not require any Strava field.

Registration is a complete rNet change, not just a new JSON file:

1. Add the vocabulary schema and spec entry, and update the core schema's vocabulary description
   and current documentation inventories where applicable.
2. Add the `activityPropertiesSchema` / `ActivityProperties` public names in
   `packages/types/codegen/generate.ts`, then regenerate the committed schema/type exports.
3. Add `activity` to `SchemaTypes`, exported validators, and `OBJECT_TYPES_REGISTRY` in
   `packages/types/src/validators.ts`. Both standalone properties validation and full MediaObject
   validation must enforce the vocabulary.
4. Add valid/invalid vocabulary and full-object fixtures, including a non-Strava activity,
   unavailable metrics, time representations, and malformed lap/split records. Run rNet's
   codegen freshness, typecheck, and validator/fixture gates.
5. Consume those exports in the Strava candidate compiler and verify Rhizome's ingestion and
   object-creation boundaries reject malformed activity properties through the shared validator.
   Wire the schema into `apps/server/src/routes/contracts.ts` (schema references and
   `RNET_DOCUMENTS`), its component name into `apps/server/src/openapi.ts`, and the canonical
   type alias/import into `scripts/generate-host-openapi.ts`; regenerate host OpenAPI contracts.
   This exposes the registered vocabulary without adding provider-specific routes or duplicated
   TypeScript shapes. Run Rhizome's contract, typecheck, and generated-output checks.

Land the canonical schema and validator integration before the ingest skill. The dependency
continues to point from Rhizome to rNet. This is a pre-production addition: no legacy
`strava.activity` representation, compatibility decoder, or data backfill is needed.

### 3.2 Measurement and presentation rules

The source contains available title, sport, date/time, distance, elapsed time, moving time,
elevation, and recorded workout/race classification. Canonical distances are meters and
durations are seconds; presentation may show miles and minutes per mile. Preserve the meaning
of exported time values: a local timestamp without an offset is not silently converted to UTC,
and a missing metric is not zero. Resolve ambiguous units or duplicate CSV headings using the
recognized export dialect, never by guessing from API fields or the user's display preference.

Keep recorded laps separate from uniform mile splits:

- A recorded lap retains its actual distance and recorded timing basis. A device lap can be a
  kilometer or an interval; calling every lap a mile would misrepresent the run.
- A computed mile is a deterministic calculation over distance/time evidence, using 1,609.344
  meters and a documented boundary/interpolation rule. Preserve the final partial mile with its
  actual distance. Mark calculation method, distance basis, and timing basis explicitly.
- Elapsed, timer, and moving durations retain their distinct meanings. Prefer recorded distance
  and timer evidence where available. Any GPS-derived fallback must be identified and tested;
  timestamp differences alone must not be labeled moving time.
- When the evidence cannot support splits, report them as unavailable. Dividing total duration
  by total distance produces average pace, not individual mile times. Do not claim reconstructed
  values exactly match Strava's own processing or official race measurements.

Store bounded lap/split records as structured source properties that clients can query. Raw
second-by-second samples remain replayable from the origin; do not dump entire sensor streams
into model context or invent a media element for a numeric dataset. Scalar activity records
normally have `elements: []`. If a later slice imports authored descriptions or photographs,
those use the existing text/image element rules.

Define explicit per-activity lap/split counts and serialized-output byte budgets. Existing source
limits cover captures, candidates, and element bytes, but do not independently bound an object's
nested JSON. Facts needed by a future running dMachine must be compiled into object properties:
delegated clients cannot open the owner-only origin to derive them themselves.

Official race results are distinct from a watch recording. Preserve explicit exported race
labels when present. Owner-entered event names, race classifications, official chip/gun times,
and result links belong in `user.properties`; a run title alone does not establish an official
result. Ingestion does not write either `user` or `inferred`.

Weekly mileage, pace charts, and comparisons should calculate from these factual records in
the consuming application. Optional model interpretations belong in `inferred`. Existing M3
tasks operate on the bounded canonical records through their usual eligibility and metering
paths; a model is not needed to calculate a mile split or total distance.

## 4. Skill boundary and review

The skill owns `manifest.ts`, parser/contracts, candidate compilation, `verify.ts`, `SKILL.md`,
`VERIFY.md`, `BOUNDARIES.md`, and synthetic fixtures/tests. Keep format-specific modules under
this directory. Introduce a shared activity family only when another implemented source needs it.

Implement `FileSourceSkill` from `apps/ingest/file-sources/types.ts` and register it in
`apps/ingest/src/source-skill-catalog.ts`. The pipeline stays:

```text
uploaded origin -> Strava parser -> VERIFY -> candidate_bundle@1
                -> generic preview -> owner confirmation -> atomic commit
```

The generic host renders the source manifest and reviewed candidates. The server owns storage,
limits, authorization, review integrity, and commit behavior. Neither gains provider parsing
branches. Parsing makes no network calls, and each object is grounded in the uploaded origin
with a pinned parser and reproducible ingest record.

The first visible review must communicate run count, date coverage, excluded activity counts,
and detail availability. A user must be able to tell whether mile splits will be available before
confirming. Extend generic VERIFY presentation only where the existing report cannot express this.

## 5. Shared work required by this source

**Archive support.** Extract the bounded ZIP reader currently under `skills/x/zip.ts` into a
shared skill-facing module before reusing it. Add a total expanded-byte budget across files,
alongside entry count, per-entry size, compression, path, collision, and nested-decompression
guards. Expand only recognized activity inputs. Extract/generalize the reviewed-file E2E support
currently housed in the host, including its transaction-specific presentation assumptions.

**Upload size.** The current default API request cap is 50 MiB, and uploads are buffered. Source
manifest limits alone cannot raise that cap. Measure the target archive before choosing the
budget. If it exceeds the supported end-to-end transport, scope a generic upload improvement
with explicit memory bounds and tests. Do not claim all-history support while truncating the
archive, silently skipping detail files, or requiring a removed provider-specific browser parser.

**Repeated exports.** Current deduplication is per ingestion source, and a new upload creates a
new source. Matching origin hashes only deduplicates bytes. Consequently the current platform
cannot promise that a later export adds only new runs.

S1 includes a reviewed repeated-export slice after the first snapshot works. Its user-visible
contract is: unchanged runs are recognized, new runs can be added, changed runs are shown for
explicit review, and absent runs are not implicitly deleted. Preserve immutable source lineage
and existing owner annotations; do not silently replace an annotated object or copy old model
output onto changed measurements. Use a generic owner-controlled file-reselection operation:

- Upload the next export as a new immutable origin and preview it against the existing source's
  identity bindings. Keep the same logical source so ordinary per-source matching remains useful.
- Confirmation atomically rebinds that source to the new origin and applies the reviewed result.
  Failed, canceled, or stale reviews leave the existing source binding and memberships unchanged.
  Earlier origins and every existing object's source block remain immutable.
- Unchanged activities retain their object identity, annotations, and inferred entries. Accepted
  changed activities create replacements, preserving position in the selected Vibe. One explicit
  confirmation may authorize the complete displayed update; per-run selection is not required
  initially, and cancel preserves the existing snapshot. Carry annotations only through an
  explicit owner-authorized store user-block
  write with fresh history, never from parser output. Keep the old object/history and the audit
  relationship; recompute inference for the replacement.
- Review integrity binds the prior source state and the annotations shown to the owner. Revalidate
  under locks on confirm so a concurrent annotation edit cannot be lost. This is internal reviewed
  import validation; ordinary user-property writes remain last-write-wins with no revision API.
- Initially allow reselection only when the source is configured in the target Vibe alone. A source
  shared by multiple Vibes needs defined version/membership behavior before reselection is enabled;
  changing one Vibe must not silently replace records or create duplicates in another. Objects may
  still be reused in other Vibes through the existing owner-only membership surface.

External IDs are matching evidence, never permission to reuse another owner's object. A fresh
independent source remains a separate import; the host must make updating an existing import
discoverable. General file reselection beyond this contract remains M7.

## 6. Delivery order and exit evidence

1. **Export contract and fixtures.** Inspect a representative archive and capture its shape in
   synthetic fixtures: an ordinary run, a paused run, a long run with a partial mile, a race,
   an indoor/manual run, and a missing-detail case. Pin exact units, timestamps, file formats,
   and budgets. Never commit the runner's real export as a fixture.
2. **Registered activity vocabulary.** Add the rNet schema/spec, generated types, runtime registry,
   and vocabulary/full-object fixtures described in §3.1; verify the rNet gates before the source
   compiler depends on them.
3. **Reviewed activity history.** Ship the named CSV parser and source registration through the
   existing preview/confirm flow. Validate exact IDs, summary values, stable ordering, and
   complete row accounting. This establishes the history but does not complete S1.
4. **Original files and mile splits.** Add bounded archive/file decoding and lap/split compilation.
   Test known split boundaries, pauses, partial miles, inconsistent samples, mismatched originals,
   and unavailable evidence. Validate the supported archive size through the actual upload path.
5. **Reviewed newer exports.** Implement and test the reconciliation contract above. The same
   logical activity across successive exports must not silently become duplicate history.

S1 is complete when the registered `activity` vocabulary passes standalone and full-object
validation (including non-Strava fixtures), and a representative supported export yields every
expected run with accurate summary facts, available laps/mile splits, explicit coverage for
unavailable detail, and grounded
race facts; a newer export can be reviewed without duplicating unchanged runs or losing owner
annotations. Evidence must also prove preview/cancel isolation, atomic confirmation, same-source
replay, owner isolation, bounded archive failures, and zero parser network access. Stub model
calls when checking M3 integration; provider spend is not a CI dependency.

## 7. External format references

Strava documents account export and original activity export, including FIT and GPS-based
TCX/GPX alternatives. It does not specify a frozen activity CSV schema on this page, so local
fixtures must establish that contract. Access checked 2026-09-12:
[Exporting Your Data and Bulk Export](https://support.strava.com/en-us/articles/15401919-exporting-your-data-and-bulk-export).
