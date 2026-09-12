import { XMLParser, XMLValidator } from "fast-xml-parser";
import { PARSER_BUDGETS, type OriginalActivity, type DistanceSample } from "./contracts.ts";
import { optionalNumber, validInstant } from "./csv.ts";
import { validateDistanceSamples } from "./splits.ts";

type XmlNode = Record<string, unknown>;

function parseXml(bytes: Uint8Array): XmlNode {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("Activity XML cannot declare DTDs or entities");
  if ((text.match(/</g)?.length ?? 0) > PARSER_BUDGETS.xmlNodes)
    throw new Error("Activity XML exceeds its node limit");
  if (XMLValidator.validate(text) !== true) throw new Error("Malformed activity XML");
  return node(
    new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
      parseTagValue: false,
      parseAttributeValue: false,
      processEntities: false,
      trimValues: true,
      jPath: true,
      updateTag(name, path) {
        if (String(path).split(".").length > 32)
          throw new Error("Activity XML exceeds its nesting limit");
        return name;
      },
    }).parse(text),
    "activity XML",
  );
}

export function parseTcx(bytes: Uint8Array): OriginalActivity {
  const document = node(parseXml(bytes).TrainingCenterDatabase, "TCX root");
  const activities = array(node(document.Activities, "TCX Activities").Activity);
  if (activities.length !== 1) throw new Error("TCX original must contain exactly one Activity");
  const activity = node(activities[0], "TCX Activity");
  if (activity["@_Sport"] !== "Running") throw new Error("TCX original does not describe running");
  const startedAt = validInstant(string(activity.Id, "TCX Activity Id"), "TCX Activity Id");
  const laps = array(activity.Lap);
  if (laps.length > PARSER_BUDGETS.laps) throw new Error("TCX exceeds the lap count limit");
  const samples: DistanceSample[] = [];
  let missingDistance = false,
    pointsVisited = 0;
  const parsedLaps: OriginalActivity["laps"] = laps.map((value, index) => {
    const lap = node(value, "TCX Lap");
    const distance = number(lap.DistanceMeters, "TCX lap distance");
    const duration = number(lap.TotalTimeSeconds, "TCX lap total time");
    if (distance === undefined && duration === undefined)
      throw new Error("TCX lap has no measurements");
    for (const track of array(lap.Track))
      for (const point of array(node(track, "TCX Track").Trackpoint)) {
        if (++pointsVisited > PARSER_BUDGETS.samples)
          throw new Error("TCX exceeds its sample limit");
        const record = node(point, "TCX Trackpoint");
        const timestamp = validInstant(
          string(record.Time, "TCX Trackpoint Time"),
          "TCX Trackpoint Time",
        );
        const distanceM = number(record.DistanceMeters, "TCX sample distance");
        if (distanceM === undefined) {
          missingDistance = true;
          continue;
        }
        samples.push({
          distanceM,
          elapsedS: (Date.parse(timestamp) - Date.parse(startedAt)) / 1_000,
        });
      }
    return {
      index: index + 1,
      ...(distance === undefined
        ? { duration_s: duration! }
        : { distance_m: distance, ...(duration === undefined ? {} : { duration_s: duration }) }),
      timing_basis: "timer" as const,
      distance_basis: "recorded" as const,
      provenance: "tcx:Lap.DistanceMeters/TotalTimeSeconds",
    };
  });
  validateDistanceSamples(samples);
  const distanceM =
    parsedLaps.length && parsedLaps.every((lap) => lap.distance_m !== undefined)
      ? parsedLaps.reduce((sum, lap) => sum + lap.distance_m!, 0)
      : samples.at(-1)?.distanceM;
  const timerS =
    parsedLaps.length && parsedLaps.every((lap) => lap.duration_s !== undefined)
      ? parsedLaps.reduce((sum, lap) => sum + lap.duration_s!, 0)
      : undefined;
  return {
    format: "tcx",
    startedAt,
    ...(distanceM === undefined ? {} : { distanceM }),
    ...(timerS === undefined ? {} : { timerS }),
    ...(samples.length ? { elapsedS: samples.at(-1)!.elapsedS } : {}),
    laps: parsedLaps,
    samples: missingDistance ? [] : samples,
    distanceBasis: "recorded",
    provenance: "tcx:Trackpoint.DistanceMeters/Time",
  };
}

export function parseGpx(bytes: Uint8Array): OriginalActivity {
  const document = node(parseXml(bytes).gpx, "GPX root");
  const tracks = array(document.trk);
  if (tracks.length !== 1) throw new Error("GPX original must contain exactly one track");
  const segments = array(node(tracks[0], "GPX track").trkseg);
  let distanceM = 0,
    startedAt: string | undefined,
    lastTime: number | undefined;
  let pointsVisited = 0,
    missingTime = false;
  const samples: DistanceSample[] = [];
  for (const segment of segments) {
    let previous: { lat: number; lon: number } | undefined;
    for (const value of array(node(segment, "GPX segment").trkpt)) {
      if (++pointsVisited > PARSER_BUDGETS.samples) throw new Error("GPX exceeds its sample limit");
      const point = node(value, "GPX trackpoint");
      const lat = coordinate(point["@_lat"], 90),
        lon = coordinate(point["@_lon"], 180);
      if (previous) distanceM += haversine(previous.lat, previous.lon, lat, lon);
      previous = { lat, lon };
      if (point.time === undefined) {
        missingTime = true;
        continue;
      }
      const timestamp = validInstant(string(point.time, "GPX point time"), "GPX point time");
      startedAt ??= timestamp;
      const currentTime = Date.parse(timestamp);
      if (lastTime !== undefined && currentTime < lastTime)
        throw new Error("GPX timestamps decrease");
      samples.push({ distanceM, elapsedS: (currentTime - Date.parse(startedAt)) / 1_000 });
      lastTime = currentTime;
    }
  }
  // Segment discontinuities provide no distance evidence across the gap; never bridge them.
  return {
    format: "gpx",
    ...(!missingTime && startedAt ? { startedAt } : {}),
    ...(segments.length === 1 ? { distanceM } : {}),
    ...(!missingTime && samples.length ? { elapsedS: samples.at(-1)!.elapsedS } : {}),
    laps: [],
    samples: segments.length === 1 && !missingTime ? samples : [],
    distanceBasis: "gps",
    provenance: "gpx:trkpt.haversine_R6371008.8/time",
  };
}

function node(value: unknown, label: string): XmlNode {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} is missing or duplicated`);
  return value as XmlNode;
}
function array(value: unknown): unknown[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}
function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} must occur once`);
  return value;
}
function number(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : optionalNumber(string(value, label), label);
}
function coordinate(value: unknown, limit: number): number {
  if (
    typeof value !== "string" ||
    !/^-?\d+(?:\.\d+)?$/.test(value) ||
    !Number.isFinite(Number(value)) ||
    Math.abs(Number(value)) > limit
  )
    throw new Error("GPX contains invalid coordinates");
  return Number(value);
}
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180,
    dlat = (lat2 - lat1) * rad,
    dlon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dlat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dlon / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(Math.min(1, a)));
}
