# VERIFY: Strava running-history export

Run `bun test apps/ingest/skills/strava apps/ingest/source-skills/zip.test.ts` from the repository root.
`verify.ts` is the executable source report carried through generic preview and confirmation.

- The candidate count equals supported running rows; running plus explicitly excluded sports
  equals every nonempty CSV record. A snapshot with zero running candidates fails VERIFY.
- Activity IDs are valid decimal strings and unique; IDs larger than JavaScript's integer precision
  round-trip unchanged. CSV source order is preserved.
- Every candidate passes the generated `@rnet/types` activity validator. Available factual values
  and explicit workout labels survive; missing values, timezone, official race results, and split
  evidence are never fabricated. Runs without originals remain visible.
- The review states run count, date coverage, excluded sports, number of runs with recorded laps,
  number with computed mile splits, and missing/unsupported original counts. CSV-only input says
  explicitly that originals are needed for mile splits.
- ZIP filenames, case collisions, directory traversal, entry ceilings, compression ratios, signatures,
  per-entry bytes and cumulative expanded bytes are independently checked. Only referenced supported
  originals and the one CSV are read. Gzip expansion shares the total budget and has one layer.
- Original association is exact-path and must pass documented date/distance checks. Malformed,
  conflicting, duplicated, or inconsistent evidence fails instead of disappearing into missing data.
- FIT CRC/single-session and timer tests distinguish timer from elapsed splits. TCX demonstrates an
  actual non-mile lap, a pause, first-crossing interpolation, and a final half mile. GPX discloses its
  GPS distance fallback and refuses to bridge discontinuous segments.
- Replaying the same bytes yields the identical semantic candidates. Source properties exclude
  archive/row plumbing; the platform stamps owner, origin, ingest method, and parser provenance.
- No parser calls fetch, writes user/inferred blocks, creates a numeric-stream element, or exposes
  raw samples. A fetch spy fails any network attempt in the representative synthetic compilation.

Synthetic fixture coverage is executable. Real-export dialect, sample accuracy, and upload-size
verification remain outstanding until the owner supplies a representative export for local testing.
