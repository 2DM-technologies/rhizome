# Strava running-history export

`strava` is an owner-uploaded file source. `strava-export@1.0.0` parses without a model or
network connection and produces one canonical rNet `fitness_activity` per supported running row, with
`keys.strava_activity_id` and zero elements. Every object is grounded by the platform in the
uploaded OriginArtifact. Compilation returns `candidate_bundle@1`; the generic owner review and
atomic confirmation remain the only write boundary.

## Supported input contract

Accept UTF-8 `activities.csv` alone, or a ZIP with exactly one `activities.csv`, optionally inside
a containing directory. ZIP originals resolve against that CSV's directory using the row's exact
`Filename`; no basename search or fuzzy identity match is permitted. Supported referenced originals
are `.fit`, `.tcx`, `.gpx`, and each with one `.gz` suffix. Unsupported formats and missing originals
retain summary records with explicit coverage status. A present supported file that is malformed
fails the import. Other export entries remain in the owner-only raw origin but are not expanded.

The named CSV dialect is `strava.activities.english-duplicate-metrics@1`. The first twelve headers
must be, in order: Activity ID, Activity Date, Activity Name, Activity Type, Activity Description,
Elapsed Time, Distance, Max Heart Rate, Relative Effort, Commute, Activity Gear, Filename.
There must be two `Elapsed Time` columns, two `Distance` columns, one `Moving Time`, and one
`Elevation Gain`. The second elapsed/distance columns occur after Filename and mean seconds/meters;
the first display-distance column is deliberately unused because its units can vary. Other distinct
headers are tolerated and ignored, with optional `Workout Type` and `Manual` preserved. Duplicate
headers are rejected except the identified paired metrics, Max Heart Rate, and Relative Effort.
Empty values stay absent; numeric values use nonnegative decimal notation, never locale separators.

Activity Date supports explicit-offset ISO instants or the English `Sep 1, 2026, 6:00:00 AM`
representation. The latter is preserved as `started_local`, without assigning a timezone. An
original file can additionally establish `started_at`. RFC3339 `-00:00` identifies a known UTC instant
with an unknown local offset and is normalized as an instant without assigning a local timezone.
Run, Trail Run/TrailRun, Virtual Run/VirtualRun, Treadmill, and Treadmill Run are supported; all other
sports are counted as excluded. Indoor/manual rows remain valid without distance or originals.
An explicit Workout Type is preserved as a lowercase string. Numeric codes remain codes; neither a
title nor a code is guessed to mean an official race result. Official owner-entered race facts
belong in `user.properties`.

The fixtures are synthetic and pin this contract. **No representative athlete export has yet been
supplied or validated.** This parser does not claim every Strava export dialect is supported. A
different header/time/unit shape fails with an unsupported-dialect error; inspect its actual shape
before changing the parser pin or claiming compatibility. Never commit the real athlete export.

## Original evidence and measurements

FIT uses Garmin's official `@garmin/fitsdk` with header/CRC validation, exactly one running session,
scaled SI fields, and bounded messages. Session totals remain distinct from CSV processed totals.
Device laps retain their recorded distance and timer duration, falling back to elapsed lap duration
only when timer duration is absent. A complete ordered timer start/stop sequence whose final duration
matches session timer time within two seconds supports timer-based splits. Otherwise splits use
elapsed timestamps and explicitly say so. They never claim moving time from timestamps.

TCX requires exactly one Running Activity. Lap DistanceMeters and TotalTimeSeconds are recorded
distance/timer facts; Trackpoint DistanceMeters and Time support elapsed-time splits. GPX requires
one timed track; a single continuous segment supports a disclosed GPS-distance fallback using
haversine surface distances on a sphere of radius 6,371,008.8 m. Multiple GPX segments retain the
summary but provide no computed splits, because the gap has no distance evidence. GPS coordinates
and raw samples do not enter source properties or model context.

Exact CSV path binding is checked against original start and distance. Known instants must agree
within 120 seconds. Unknown-zone wall times allow offsets up to 14 hours, in 15-minute increments
with 120-second recording tolerance; this does not assign a timezone. Original distance must agree
with CSV distance within the larger of 200 m or 5%. Processed and original totals are retained
separately in canonical summary fields and `strava.original_summary`; a disagreement beyond those
bounds fails review instead of attaching possibly unrelated splits.

Mile splits use exactly 1,609.344 m and linear interpolation at the first observed crossing of each
boundary. The first sample must have recorded distance zero and occur within two seconds of the
session start. A pause at an already reached boundary belongs to the following elapsed split.
The final split includes any trailing stationary samples, preserving the sampled duration. Split
time begins at the first observed zero-distance sample; an initial delay of up to two seconds is
not fabricated into that sample. The final partial mile retains its actual distance, including sub-meter recording precision. Missing
distance evidence produces unavailable splits; decreasing distances/times and impossible samples
fail validation. Splits record timing basis, distance basis, method, and format/field provenance.
They are calculations over the original evidence, not Strava's proprietary split processing.

Sample endpoints must cover original totals within 1 m or 0.1% for distance and two seconds for
recorded elapsed duration. A shortened sample stream keeps available laps but has no calculated
splits; samples exceeding recorded totals fail. Optional GPX times can be absent; those runs retain
their summary with unavailable splits, while a malformed supplied time still fails.

Source properties contain only semantic facts. ZIP paths, CSV row numbers, archive names, and
import timestamps do not change activity identity or unchanged-export comparison. External IDs
are matching evidence scoped by the platform's owner/source bindings, never reuse authorization.

## Budgets

Upload: 48 MiB (below the current 50 MiB API cap). CSV: 16 MiB, 50,000 rows, 256 columns,
64 KiB per cell, 10,000 running candidates. ZIP: 50,000 entries and 256 MiB consumed expanded bytes,
including the extra expansion of gzip originals; 16 MiB per decoded original. FIT: 150,000 messages.
Original samples: 100,000 per activity. XML: 1,000,000 opening/closing tokens and depth 32, with
DTDs/entities forbidden. Output: at most 1,000 laps, 1,000 splits, 64 KiB serialized source properties
per object, 32 MiB aggregate source properties. Exceeding a budget fails; nothing is truncated.
Archive-size support still needs measurement against the target athlete's export.

## References

- [Strava account/original exports](https://support.strava.com/en-us/articles/15401919-exporting-your-data-and-bulk-export)
- [Official Garmin FIT JavaScript SDK](https://github.com/garmin/fit-javascript-sdk)
- [Garmin TCX v2 schema](https://www8.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd)
- [GPX 1.1 schema](https://www.topografix.com/GPX/1/1/)
- [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser)
