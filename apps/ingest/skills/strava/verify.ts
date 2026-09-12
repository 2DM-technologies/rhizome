import { validators } from "@rnet/types";
import { PARSER_BUDGETS, type ParsedStravaExport } from "./contracts.ts";
import type { SourceVerifyReport } from "../../source-skills/candidate-bundle.ts";

export function verifyStrava(
  parsed: ParsedStravaExport,
): SourceVerifyReport & { source_record_count: number; candidate_count: number } {
  const excluded = Object.values(parsed.excludedBySport).reduce((sum, count) => sum + count, 0);
  const dates = parsed.activities
    .map((activity) =>
      (activity.properties.started_local ?? activity.properties.started_at)!.slice(0, 10),
    )
    .sort();
  const withLaps = parsed.activities.filter((activity) => activity.properties.laps?.length).length;
  const withSplits = parsed.activities.filter(
    (activity) => activity.properties.splits?.length,
  ).length;
  const missing = parsed.activities.filter(
    (activity) => activity.properties.strava.detail_status === "missing",
  ).length;
  const unsupported = parsed.activities.filter(
    (activity) => activity.properties.strava.detail_status === "unsupported",
  ).length;
  const valid = parsed.activities.every((activity) =>
    validators.fitness_activity(activity.properties),
  );
  const checks = [
    {
      name: "running_history",
      ok: parsed.activities.length > 0,
      detail: `${parsed.activities.length} runs${dates.length ? ` from ${dates[0]} to ${dates.at(-1)}` : ""}; ${excluded} other activities excluded${
        excluded
          ? ` (${Object.entries(parsed.excludedBySport)
              .map(([sport, count]) => `${sport}: ${count}`)
              .join(", ")})`
          : ""
      }.`,
    },
    {
      name: "row_accounting",
      ok: parsed.sourceRecordCount === parsed.activities.length + excluded,
      detail: `${parsed.sourceRecordCount} CSV rows = ${parsed.activities.length} running activities + ${excluded} excluded activities.`,
    },
    {
      name: "unique_activity_ids",
      ok:
        new Set(parsed.activities.map((activity) => activity.id)).size === parsed.activities.length,
      detail: "Each run has one distinct Strava Activity ID; source order is preserved.",
    },
    {
      name: "activity_vocabulary",
      ok: valid,
      detail: valid
        ? "Every run passes the canonical rNet activity validator; missing metrics remain absent."
        : "An activity failed canonical vocabulary validation.",
    },
    {
      name: "detail_coverage",
      ok: true,
      detail: `${withSplits} runs with calculated mile splits; ${withLaps} with recorded laps; ${parsed.activities.length - withSplits} without mile splits. ${parsed.inputKind === "csv" ? "CSV-only import contains summary facts; original files are needed for splits." : `${missing} missing originals; ${unsupported} unsupported originals. Runs remain importable without detail.`}`,
    },
    {
      name: "bounded_properties",
      ok: parsed.activities.every(
        (activity) =>
          Buffer.byteLength(JSON.stringify(activity.properties)) <= PARSER_BUDGETS.objectBytes,
      ),
      detail:
        "Recorded laps and calculated splits are bounded; second-by-second sensor samples remain only in the owner-only origin.",
    },
  ];
  return {
    ok: checks.every((check) => check.ok),
    source_record_count: parsed.sourceRecordCount,
    candidate_count: parsed.activities.length,
    checks,
  };
}
