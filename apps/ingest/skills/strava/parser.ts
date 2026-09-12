import { gunzipSync } from "node:zlib";
import type { SourceParser } from "../../source-skills/candidate-bundle.ts";
import { openValidatedZip, readZipBytes } from "../../source-skills/zip.ts";
import {
  STRAVA_PARSER_NAME,
  STRAVA_PARSER_VERSION,
  STRAVA_LIMITS,
  PARSER_BUDGETS,
  type ParsedStravaExport,
  type ParsedStravaActivity,
  type OriginalActivity,
} from "./contracts.ts";
import { parseActivitiesCsv } from "./csv.ts";
import { parseFit } from "./fit.ts";
import { parseTcx, parseGpx } from "./xml.ts";
import { calculateMileSplits } from "./splits.ts";

export const stravaParser: SourceParser<ParsedStravaExport> = {
  name: STRAVA_PARSER_NAME,
  version: STRAVA_PARSER_VERSION,
  parse: parseStravaExport,
};

export async function parseStravaExport(bytes: Uint8Array): Promise<ParsedStravaExport> {
  if (!bytes.byteLength || bytes.byteLength > STRAVA_LIMITS.maxCaptureBytes)
    throw new Error("Strava export exceeds its capture limit or is empty");
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    if (bytes.byteLength > PARSER_BUDGETS.csvBytes)
      throw new Error("Strava CSV exceeds its byte limit");
    const parsed = parseActivitiesCsv(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    assertOutputBudget(parsed);
    return parsed;
  }
  const archive = await openValidatedZip(
    new Blob([Uint8Array.from(bytes).buffer]),
    PARSER_BUDGETS.archiveEntries,
    PARSER_BUDGETS.expandedBytes,
  );
  try {
    const csvs = archive.entries.filter(
      (entry) => !entry.directory && /(?:^|\/)activities\.csv$/.test(entry.filename),
    );
    if (csvs.length !== 1)
      throw new Error("Strava archive must contain exactly one activities.csv");
    const csv = csvs[0]!,
      prefix = csv.filename.slice(0, -"activities.csv".length);
    const csvBytes = await readZipBytes(csv, PARSER_BUDGETS.csvBytes);
    const parsed = parseActivitiesCsv(new TextDecoder("utf-8", { fatal: true }).decode(csvBytes));
    parsed.inputKind = "archive";
    let expandedBytes = csvBytes.byteLength;
    for (const activity of parsed.activities) {
      activity.properties.strava.detail_status = "missing";
      if (!activity.originalPath) continue;
      const entry = archive.byPath.get(prefix + activity.originalPath);
      if (!entry) continue;
      const extension = /\.(fit|tcx|gpx)(\.gz)?$/i.exec(activity.originalPath);
      if (!extension) {
        activity.properties.strava.detail_status = "unsupported";
        continue;
      }
      let original = await readZipBytes(entry, PARSER_BUDGETS.originalBytes);
      expandedBytes += original.byteLength;
      if (extension[2]) {
        // One gzip layer only. Node enforces maxOutputLength while inflating, before allocation.
        original = new Uint8Array(
          gunzipSync(original, {
            maxOutputLength: Math.min(
              PARSER_BUDGETS.originalBytes,
              PARSER_BUDGETS.expandedBytes - expandedBytes,
            ),
          }),
        );
        expandedBytes += original.byteLength;
      }
      if (expandedBytes > PARSER_BUDGETS.expandedBytes)
        throw new Error("Strava archive exceeds its total expanded-byte limit");
      let detail: OriginalActivity;
      try {
        detail =
          extension[1]!.toLowerCase() === "fit"
            ? parseFit(original)
            : extension[1]!.toLowerCase() === "tcx"
              ? parseTcx(original)
              : parseGpx(original);
        attachOriginal(activity, detail);
      } catch (error) {
        throw new Error(
          `Strava activity ${activity.id} original is invalid: ${error instanceof Error ? error.message : "decode failure"}`,
        );
      }
    }
    assertOutputBudget(parsed);
    return parsed;
  } finally {
    await archive.close();
  }
}

function attachOriginal(activity: ParsedStravaActivity, original: OriginalActivity): void {
  const properties = activity.properties;
  const summaryStart = properties.started_at
    ? Date.parse(properties.started_at)
    : Date.parse(`${properties.started_local}Z`);
  const startDifference = original.startedAt
    ? Math.abs(summaryStart - Date.parse(original.startedAt)) / 1_000
    : undefined;
  // CSV wall times without offsets permit real-world timezones, without assigning one.
  // Exact path binding plus this and distance checks prevents accidental cross-run association.
  if (
    startDifference !== undefined &&
    (properties.started_at
      ? startDifference > 120
      : startDifference > 14 * 3_600 + 120 ||
        Math.min(startDifference % 900, 900 - (startDifference % 900)) > 120)
  )
    throw new Error("original start time conflicts with its CSV row");
  if (
    properties.distance_m !== undefined &&
    original.distanceM !== undefined &&
    Math.abs(properties.distance_m - original.distanceM) >
      Math.max(200, properties.distance_m * 0.05)
  )
    throw new Error("original distance conflicts with its CSV row (200 m / 5% tolerance)");
  if (original.startedAt) properties.started_at = original.startedAt;
  const splits = calculateMileSplits(original);
  if (original.laps.length) properties.laps = original.laps;
  if (splits.length) properties.splits = splits;
  // Keep the export's processed totals and original measurements independently attributable.
  const summary = {
    ...(original.distanceM === undefined ? {} : { distance_m: original.distanceM }),
    ...(original.elapsedS === undefined ? {} : { elapsed_time_s: original.elapsedS }),
    ...(original.timerS === undefined ? {} : { timer_time_s: original.timerS }),
  };
  if (original.timerS !== undefined) properties.timer_time_s = original.timerS;
  properties.strava.original_format = original.format;
  if (Object.keys(summary).length) properties.strava.original_summary = summary;
  properties.strava.detail_status = splits.length
    ? "splits"
    : original.laps.length
      ? "laps_only"
      : "no_distance_samples";
}

function assertOutputBudget(parsed: ParsedStravaExport): void {
  let total = 0;
  for (const activity of parsed.activities) {
    const size = Buffer.byteLength(JSON.stringify(activity.properties), "utf8");
    if (size > PARSER_BUDGETS.objectBytes)
      throw new Error(`Strava activity ${activity.id} exceeds its properties byte limit`);
    total += size;
    if (total > PARSER_BUDGETS.outputBytes)
      throw new Error("Strava export exceeds its total output byte limit");
  }
}
