import {
  PARSER_BUDGETS,
  STRAVA_CSV_DIALECT,
  STRAVA_LIMITS,
  type ParsedStravaExport,
  type ParsedStravaActivity,
} from "./contracts.ts";

const PREFIX = [
  "Activity ID",
  "Activity Date",
  "Activity Name",
  "Activity Type",
  "Activity Description",
  "Elapsed Time",
  "Distance",
  "Max Heart Rate",
  "Relative Effort",
  "Commute",
  "Activity Gear",
  "Filename",
];
const RUN_TYPES = new Set([
  "Run",
  "Trail Run",
  "TrailRun",
  "Virtual Run",
  "VirtualRun",
  "Treadmill",
  "Treadmill Run",
]);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The repeated machine metrics, never the display-distance column, establish SI units. */
export function parseActivitiesCsv(text: string): ParsedStravaExport {
  const rows = readCsv(text.replace(/^\uFEFF/, ""));
  const headers = rows.shift();
  if (!headers || !PREFIX.every((name, index) => headers[index] === name))
    throw new Error(
      "Unsupported Strava activities.csv dialect: expected the English account-export header",
    );
  const positions = new Map<string, number[]>();
  headers.forEach((name, index) => {
    if (!name) throw new Error("Strava CSV contains an empty header");
    positions.set(name, [...(positions.get(name) ?? []), index]);
  });
  for (const [name, count] of [
    ["Elapsed Time", 2],
    ["Distance", 2],
    ["Moving Time", 1],
    ["Elevation Gain", 1],
  ] as const) {
    if (positions.get(name)?.length !== count)
      throw new Error(`Unsupported Strava CSV dialect: expected ${count} ${name} columns`);
  }
  for (const [name, indexes] of positions) {
    if (
      indexes.length > 1 &&
      !["Elapsed Time", "Distance", "Max Heart Rate", "Relative Effort"].includes(name)
    )
      throw new Error(`Strava CSV repeats an ambiguous ${name} header`);
    if (indexes.length > 2) throw new Error(`Strava CSV repeats an ambiguous ${name} header`);
  }
  // The second occurrences are the export's detailed, SI-valued columns after Filename.
  if (positions.get("Distance")![1]! <= 11 || positions.get("Elapsed Time")![1]! <= 11)
    throw new Error("Unsupported Strava CSV metric column order");
  const activities: ParsedStravaActivity[] = [];
  const excludedBySport: Record<string, number> = Object.create(null);
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const label = `Strava CSV row ${index + 2}`;
    if (row.length !== headers.length)
      throw new Error(`${label} has ${row.length} fields; expected ${headers.length}`);
    const value = (name: string, occurrence = 0) =>
      row[positions.get(name)?.[occurrence] ?? -1]?.trim() ?? "";
    const id = value("Activity ID");
    if (!/^[1-9][0-9]{0,29}$/.test(id) || ids.has(id))
      throw new Error(`${label} has an invalid or duplicate Activity ID`);
    ids.add(id);
    const sport = value("Activity Type");
    if (!sport || sport.length > 100) throw new Error(`${label} has an invalid Activity Type`);
    const started = parseExportDate(value("Activity Date"), label);
    const originalPath = value("Filename");
    if (originalPath) {
      if (
        !/^activities\/[^\\\u0000?#:]+$/u.test(originalPath) ||
        originalPath.split("/").some((part) => !part || part === "." || part === "..")
      )
        throw new Error(`${label} has an unsafe original Filename`);
      if (paths.has(originalPath.toLowerCase()))
        throw new Error(`${label} reuses an original Filename`);
      paths.add(originalPath.toLowerCase());
    }
    if (!RUN_TYPES.has(sport)) {
      Object.defineProperty(excludedBySport, sport, {
        value: (excludedBySport[sport] ?? 0) + 1,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      continue;
    }
    if (activities.length >= STRAVA_LIMITS.maxCandidates)
      throw new Error("Strava export exceeds the running activity limit");
    const metric = (name: string, occurrence = 0) =>
      optionalNumber(value(name, occurrence), `${label} ${name}`);
    const elapsed = metric("Elapsed Time", 1);
    const moving = metric("Moving Time");
    const distance = metric("Distance", 1);
    const elevation = metric("Elevation Gain");
    if (elapsed !== undefined && moving !== undefined && moving > elapsed + 1)
      throw new Error(`${label} moving time exceeds elapsed time`);
    const title = value("Activity Name");
    if (title.length > 1_024) throw new Error(`${label} title exceeds its limit`);
    const workout = value("Workout Type");
    if (workout.length > 100) throw new Error(`${label} Workout Type exceeds its limit`);
    const manual = value("Manual");
    if (manual && !/^(?:true|false)$/i.test(manual))
      throw new Error(`${label} has invalid Manual flag`);
    activities.push({
      id,
      ...(originalPath ? { originalPath } : {}),
      properties: {
        sport: "run",
        ...started,
        ...(title ? { title } : {}),
        ...(elapsed === undefined ? {} : { elapsed_time_s: elapsed }),
        ...(moving === undefined ? {} : { moving_time_s: moving }),
        ...(distance === undefined ? {} : { distance_m: distance }),
        ...(elevation === undefined ? {} : { elevation_gain_m: elevation }),
        ...(workout ? { workout_type: workout.toLowerCase() } : {}),
        strava: {
          activity_type: sport,
          detail_status: "summary_only",
          ...(manual ? { manual: manual.toLowerCase() === "true" } : {}),
        },
      },
    });
  }
  return {
    dialect: STRAVA_CSV_DIALECT,
    sourceRecordCount: rows.length,
    excludedBySport,
    activities,
    inputKind: "csv",
  };
}

export function optionalNumber(value: string, label: string): number | undefined {
  if (!value) return undefined;
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))
    throw new Error(`${label} must be a nonnegative decimal`);
  const number = Number(value);
  if (!Number.isFinite(number) || number > 1e12)
    throw new Error(`${label} exceeds its numeric limit`);
  return number;
}

function parseExportDate(
  value: string,
  label: string,
): { started_at: string } | { started_local: string } {
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value))
    return { started_at: validInstant(value, label) };
  const match = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}), (\d{1,2}):(\d\d):(\d\d) (AM|PM)$/.exec(value);
  if (!match) throw new Error(`${label} uses an unsupported Activity Date representation`);
  const month = MONTHS.indexOf(match[1]!);
  const hour = Number(match[4]);
  if (month < 0 || hour < 1 || hour > 12) throw new Error(`${label} has an invalid date`);
  const local = `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[2]!.padStart(2, "0")}T${String((hour % 12) + (match[7] === "PM" ? 12 : 0)).padStart(2, "0")}:${match[5]}:${match[6]}`;
  validInstant(`${local}Z`, label);
  return { started_local: local };
}

export function validInstant(value: string, label: string): string {
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error(`${label} has an invalid instant`);
  const wall = value.slice(0, 19);
  const parsed = new Date(`${wall}Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 19) !== wall)
    throw new Error(`${label} has an invalid calendar date/time`);
  return new Date(value).toISOString();
}

/** RFC4180 quoting with strict row widths and bounded cells/rows, without locale guessing. */
function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  function field() {
    row.push(cell);
    cell = "";
    closed = false;
    if (row.length > 256) throw new Error("Strava CSV exceeds its column limit");
  }
  function record() {
    field();
    if (row.some((value) => value !== "")) {
      rows.push(row);
      if (rows.length > PARSER_BUDGETS.sourceRows + 1)
        throw new Error("Strava CSV exceeds its row limit");
    }
    row = [];
  }
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === "\u0000") throw new Error("Strava CSV contains a NUL byte");
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += char;
    } else if (char === ",") field();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      record();
    } else if (char === '"' && cell === "" && !closed) quoted = true;
    else if (closed || char === '"') throw new Error("Strava CSV has malformed quoting");
    else cell += char;
    if (cell.length > 64 * 1_024) throw new Error("Strava CSV cell exceeds its limit");
  }
  if (quoted) throw new Error("Strava CSV has an unterminated quoted field");
  if (cell !== "" || row.length || closed) record();
  return rows;
}
