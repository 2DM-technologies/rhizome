import type { FitnessActivityProperties, MediaObject } from "@rnet/types";

export const METERS_PER_MILE = 1609.344;
const localDateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});
export type DistanceUnit = "mi" | "km";
export type TimingBasis = "elapsed" | "timer" | "moving";
export const timingLabels: Record<TimingBasis, string> = {
  elapsed: "Elapsed",
  timer: "Timer",
  moving: "Moving",
};
export const activityFacts = (object: MediaObject) =>
  object.source.properties as FitnessActivityProperties;
export const metersPerUnit = (unit: DistanceUnit) => (unit === "mi" ? METERS_PER_MILE : 1000);
export function measurement(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
export function distanceLabel(value: unknown, unit: DistanceUnit): string {
  const meters = measurement(value);
  return meters === undefined
    ? "Unavailable"
    : `${(meters / metersPerUnit(unit)).toFixed(2)} ${unit}`;
}
export function durationLabel(value: unknown): string {
  const seconds = measurement(value);
  if (seconds === undefined) return "Unavailable";
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = String(rounded % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}`
    : `${minutes}:${remainder}`;
}
export function paceLabel(distance: unknown, duration: unknown, unit: DistanceUnit): string {
  const meters = measurement(distance),
    seconds = measurement(duration);
  return meters && seconds !== undefined && seconds > 0
    ? `${durationLabel((seconds * metersPerUnit(unit)) / meters)} / ${unit}`
    : "Unavailable";
}
export function activityDuration(object: MediaObject, basis: TimingBasis): number | undefined {
  return measurement(activityFacts(object)[`${basis}_time_s`]);
}
/** Calendar grouping uses the source's wall time/offset, never the browser's time zone. */
export function activityDate(
  object: MediaObject,
): { key: string; label: string; zone: string; raw: string } | undefined {
  const facts = activityFacts(object);
  const raw = typeof facts.started_local === "string" ? facts.started_local : facts.started_at;
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}/u.test(raw)) return;
  let key = raw.slice(0, 19).replace("t", "T");
  const offset = raw.match(/(Z|[+-]\d{2}:\d{2})$/iu)?.[1]?.toUpperCase();
  let zone =
    offset === "-00:00"
      ? "UTC · local offset unknown"
      : offset
        ? offset === "Z"
          ? "UTC"
          : `UTC${offset}`
        : "Time zone unknown";
  if (typeof facts.timezone === "string") {
    zone = facts.timezone;
    if (!facts.started_local && facts.started_at) {
      try {
        const parts = new Intl.DateTimeFormat("en-CA", {
          timeZone: facts.timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        }).formatToParts(new Date(facts.started_at));
        const part = (type: Intl.DateTimeFormatPartTypes) =>
          parts.find((entry) => entry.type === type)?.value;
        key = `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
      } catch {
        // A source time zone label may not be an IANA name; keep its explicit timestamp offset.
      }
    }
  }
  const date = new Date(`${key.slice(0, 16)}:00Z`);
  if (!Number.isFinite(date.getTime())) return;
  const label = localDateFormat.format(date);
  return { key, label, zone, raw };
}
export function newestActivities(objects: MediaObject[]) {
  return objects
    .map((object, position) => ({ object, position, date: activityDate(object) }))
    .sort(
      (a, b) => (b.date?.key ?? "").localeCompare(a.date?.key ?? "") || a.position - b.position,
    );
}
export function uniqueActivities(objects: MediaObject[]): MediaObject[] {
  return [...new Map(objects.map((object) => [object.uri, object])).values()];
}
export function isSourceRace(object: MediaObject): boolean {
  return activityFacts(object).workout_type === "race";
}
export interface ActivityWeek {
  key: string;
  meters: number;
  activities: number;
  measured: number;
}
export function weeklyDistance(objects: MediaObject[]): ActivityWeek[] {
  const dated = uniqueActivities(objects).flatMap((object) => {
    const date = activityDate(object);
    if (!date) return [];
    const day = new Date(`${date.key.slice(0, 10)}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
    return [{ object, week: day.toISOString().slice(0, 10) }];
  });
  const latest = dated
    .map(({ week }) => week)
    .sort()
    .at(-1);
  if (!latest) return [];
  return Array.from({ length: 8 }, (_, index) => {
    const week = new Date(`${latest}T00:00:00Z`);
    week.setUTCDate(week.getUTCDate() - (7 - index) * 7);
    const key = week.toISOString().slice(0, 10);
    const records = dated.filter((entry) => entry.week === key);
    const distances = records
      .map(({ object }) => measurement(activityFacts(object).distance_m))
      .filter((value) => value !== undefined);
    return {
      key,
      meters: distances.reduce((a, b) => a + b, 0),
      activities: records.length,
      measured: distances.length,
    };
  });
}
export function runPaceHistory(objects: MediaObject[], basis: TimingBasis, unit: DistanceUnit) {
  return newestActivities(uniqueActivities(objects))
    .reverse()
    .flatMap(({ object, date }) => {
      if (!date || activityFacts(object).sport !== "run") return [];
      const meters = measurement(activityFacts(object).distance_m),
        seconds = activityDuration(object, basis);
      return meters && seconds !== undefined && seconds > 0
        ? [{ object, date, pace: (seconds * metersPerUnit(unit)) / meters }]
        : [];
    })
    .slice(-24);
}
