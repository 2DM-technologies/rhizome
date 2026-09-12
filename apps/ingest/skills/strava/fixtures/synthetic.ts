import {
  Encoder,
  type FileIdMesg,
  type RecordMesg,
  type SessionMesg,
  type LapMesg,
  type EventMesg,
} from "@garmin/fitsdk";
import { BlobWriter, Uint8ArrayReader, ZipWriter } from "@zip.js/zip.js";
import { gzipSync } from "node:zlib";

/** All values are invented. No athlete export, coordinates, or race result is retained here. */
export const CSV_HEADERS = [
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
  "Athlete Weight",
  "Bike Weight",
  "Elapsed Time",
  "Moving Time",
  "Distance",
  "Max Speed",
  "Average Speed",
  "Elevation Gain",
  "Workout Type",
  "Manual",
];
export interface SyntheticRow {
  id?: string;
  date?: string;
  title?: string;
  sport?: string;
  filename?: string;
  distance?: string;
  elapsed?: string;
  moving?: string;
  workout?: string;
  manual?: string;
}
export function activityCsv(rows: SyntheticRow[], headers = CSV_HEADERS): Uint8Array {
  return new TextEncoder().encode(
    [
      headers,
      ...rows.map((row, index) => [
        row.id ?? String(index + 1),
        row.date ?? "Sep 1, 2026, 6:00:00 AM",
        row.title ?? "Morning run",
        row.sport ?? "Run",
        "",
        row.elapsed ?? "1200",
        "2.00",
        "",
        "",
        "false",
        "",
        row.filename ?? "",
        "",
        "",
        row.elapsed ?? "1200",
        row.moving ?? "1140",
        row.distance ?? "3218.688",
        "",
        "",
        "12",
        row.workout ?? "",
        row.manual ?? "",
      ]),
    ]
      .map((row) =>
        row
          .map((value) => (/[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value))
          .join(","),
      )
      .join("\r\n") + "\r\n",
  );
}

export const START = "2026-09-01T06:00:00.000Z";
export function syntheticTcx(
  options: {
    samples?: Array<[number, number]>;
    distance?: number;
    timer?: number;
    start?: string;
  } = {},
): Uint8Array {
  const start = options.start ?? START;
  const samples = options.samples ?? [
    [0, 0],
    [804.672, 300],
    [1609.344, 600],
    [1609.344, 660],
    [2414.016, 960],
    [3218.688, 1260],
    [4023.36, 1560],
  ];
  return new TextEncoder().encode(
    `<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity Sport="Running"><Id>${start}</Id><Lap StartTime="${start}"><TotalTimeSeconds>${options.timer ?? 1500}</TotalTimeSeconds><DistanceMeters>${options.distance ?? samples.at(-1)![0]}</DistanceMeters><Track>${samples.map(([distance, seconds]) => `<Trackpoint><Time>${new Date(Date.parse(start) + seconds * 1000).toISOString()}</Time><DistanceMeters>${distance}</DistanceMeters></Trackpoint>`).join("")}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`,
  );
}

export function syntheticFit(
  options: { withEvents?: boolean; start?: string; distance?: number } = {},
): Uint8Array {
  const encoder = new Encoder(),
    start = new Date(options.start ?? START);
  const at = (seconds: number) => new Date(start.valueOf() + seconds * 1000);
  encoder.onMesg(0, {
    type: "activity",
    manufacturer: "development",
    timeCreated: start,
  } as FileIdMesg);
  if (options.withEvents !== false)
    encoder.onMesg(21, { timestamp: start, event: "timer", eventType: "start" } as EventMesg);
  for (const [distance, seconds] of [
    [0, 0],
    [804.67, 300],
    [1609.34, 600],
    [1609.34, 660],
    [2414.02, 960],
    [3218.69, 1260],
  ] as const) {
    if (options.withEvents !== false && seconds === 600)
      encoder.onMesg(21, {
        timestamp: at(seconds),
        event: "timer",
        eventType: "stopAll",
      } as EventMesg);
    if (options.withEvents !== false && seconds === 660)
      encoder.onMesg(21, {
        timestamp: at(seconds),
        event: "timer",
        eventType: "start",
      } as EventMesg);
    encoder.onMesg(20, { timestamp: at(seconds), distance } as RecordMesg);
  }
  if (options.withEvents !== false)
    encoder.onMesg(21, { timestamp: at(1260), event: "timer", eventType: "stopAll" } as EventMesg);
  encoder.onMesg(19, {
    timestamp: at(1260),
    startTime: start,
    totalDistance: options.distance ?? 3218.69,
    totalElapsedTime: 1260,
    totalTimerTime: 1200,
  } as LapMesg);
  encoder.onMesg(18, {
    timestamp: at(1260),
    startTime: start,
    sport: "running",
    totalDistance: options.distance ?? 3218.69,
    totalElapsedTime: 1260,
    totalTimerTime: 1200,
  } as SessionMesg);
  return encoder.close();
}

export function syntheticGpx(): Uint8Array {
  return new TextEncoder().encode(
    `<?xml version="1.0"?><gpx version="1.1" creator="Synthetic fixture" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${[0, 0.007, 0.014, 0.021, 0.028].map((lat, index) => `<trkpt lat="${lat}" lon="0"><time>${new Date(Date.parse(START) + index * 300_000).toISOString()}</time></trkpt>`).join("")}</trkseg></trk></gpx>`,
  );
}

export async function exportZip(
  rows: SyntheticRow[],
  files: Record<string, Uint8Array> = {},
  prefix = "",
): Promise<Uint8Array> {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  await writer.add(`${prefix}activities.csv`, new Uint8ArrayReader(activityCsv(rows)));
  for (const [path, bytes] of Object.entries(files))
    await writer.add(prefix + path, new Uint8ArrayReader(bytes));
  return new Uint8Array(await (await writer.close()).arrayBuffer());
}

export async function representativeSyntheticExport(): Promise<Uint8Array> {
  return exportZip(
    [
      {
        id: "9007199254740993123",
        title: "Paused long run",
        filename: "activities/100.tcx",
        distance: "4023.36",
        elapsed: "1560",
        moving: "1500",
      },
      {
        id: "2",
        title: "Saturday race",
        filename: "activities/200.fit.gz",
        elapsed: "1260",
        moving: "1200",
        workout: "Race",
      },
      {
        id: "3",
        title: "Indoor manual run",
        sport: "Virtual Run",
        manual: "true",
        distance: "",
        elapsed: "1800",
        moving: "",
      },
      { id: "4", title: "Missing original", filename: "activities/missing.fit" },
      { id: "5", title: "Commute", sport: "Ride" },
      {
        id: "6",
        title: "Track recording",
        filename: "activities/600.gpx",
        distance: "3113.462",
        elapsed: "1200",
        moving: "1200",
      },
    ],
    {
      "activities/100.tcx": syntheticTcx(),
      "activities/200.fit.gz": new Uint8Array(gzipSync(syntheticFit())),
      "activities/600.gpx": syntheticGpx(),
      "photos/unread.txt": new TextEncoder().encode("unconsumed private export content"),
    },
  );
}
