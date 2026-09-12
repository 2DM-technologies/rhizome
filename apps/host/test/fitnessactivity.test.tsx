import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { MediaObject } from "@rnet/types";
import { FitnessActivityLog } from "../src/surfaces/FitnessActivityLog.tsx";
import {
  activityDate,
  activityDuration,
  distanceLabel,
  durationLabel,
  isSourceRace,
  METERS_PER_MILE,
  newestActivities,
  paceLabel,
  runPaceHistory,
  uniqueActivities,
  weeklyDistance,
} from "../src/surfaces/fitnessactivity.ts";

function activity(index: number, properties: Record<string, unknown>): MediaObject {
  return {
    rnet_schema: "0.1",
    uri: `rnet://object/0198f2a1-7c3d-7e4b-9f21-${String(index).padStart(12, "0")}`,
    owner: "rnet://id/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47",
    type: "fitness_activity",
    elements: [],
    source: {
      ingest: { method: "parser", reproducible: true },
      origins: [],
      properties: { sport: "run", started_local: "2026-09-12T06:30:00", ...properties },
    },
  };
}

describe("fitness activity calculations", () => {
  test("converts canonical meters/seconds and preserves unknown or zero measurements", () => {
    expect(distanceLabel(METERS_PER_MILE, "mi")).toBe("1.00 mi");
    expect(distanceLabel(1000, "km")).toBe("1.00 km");
    expect(distanceLabel(0, "mi")).toBe("0.00 mi");
    expect(paceLabel(METERS_PER_MILE * 2, 960, "mi")).toBe("8:00 / mi");
    expect(paceLabel(METERS_PER_MILE, 479.8, "mi")).toBe("8:00 / mi");
    expect(durationLabel(3661)).toBe("1:01:01");
    for (const value of [undefined, null, -1, Infinity, "500"])
      expect(distanceLabel(value, "mi")).toBe("Unavailable");
    expect(paceLabel(0, 500, "mi")).toBe("Unavailable");
    expect(paceLabel(1000, 0, "mi")).toBe("Unavailable");
  });
  test("never substitutes a different duration basis", () => {
    const record = activity(1, { elapsed_time_s: 600, moving_time_s: 500 });
    expect(activityDuration(record, "elapsed")).toBe(600);
    expect(activityDuration(record, "moving")).toBe(500);
    expect(activityDuration(record, "timer")).toBeUndefined();
  });
  test("does not reinterpret unknown local dates in the browser time zone", () => {
    const local = activityDate(activity(1, { started_local: "2026-09-12T00:30:00" }))!;
    expect(local.key).toBe("2026-09-12T00:30:00");
    expect(local.zone).toBe("Time zone unknown");
    const instant = activity(2, {
      started_local: undefined,
      started_at: "2026-09-12T23:30:00-04:00",
    });
    expect(activityDate(instant)?.key).toBe("2026-09-12T23:30:00");
    expect(activityDate(instant)?.zone).toBe("UTC-04:00");
    expect(
      activityDate(
        activity(4, { started_local: undefined, started_at: "2026-09-12T23:30:00-00:00" }),
      )?.zone,
    ).toBe("UTC · local offset unknown");
    expect(
      activityDate(activity(5, { started_local: undefined, started_at: "2026-09-12t23:30:00z" }))
        ?.zone,
    ).toBe("UTC");
    const knownZone = activity(3, {
      started_local: undefined,
      started_at: "2026-09-13T03:30:00Z",
      timezone: "America/New_York",
    });
    expect(activityDate(knownZone)?.key).toBe("2026-09-12T23:30:00");
    expect(newestActivities([activity(1, {}), instant]).map(({ object }) => object.uri)).toEqual([
      instant.uri,
      activity(1, {}).uri,
    ]);
  });
  test("weekly totals deduplicate identity while preserving missing measurement coverage and gaps", () => {
    const first = activity(1, { started_local: "2026-09-06T10:00:00", distance_m: 1000 });
    const second = activity(2, { started_local: "2026-09-07T10:00:00", distance_m: 2000 });
    const missing = activity(3, { started_local: "2026-09-12T10:00:00" });
    const weeks = weeklyDistance([first, first, second, missing]);
    expect(weeks).toHaveLength(8);
    expect(weeks.at(-2)).toEqual({ key: "2026-08-31", activities: 1, measured: 1, meters: 1000 });
    expect(weeks.at(-1)).toEqual({ key: "2026-09-07", activities: 2, measured: 1, meters: 2000 });
    expect(weeks[0]?.activities).toBe(0);
    expect(uniqueActivities([first, first])).toHaveLength(1);
    expect(newestActivities([first, first])).toHaveLength(2);
  });
  test("pace history uses only runs with both measurements in the selected basis", () => {
    const run = activity(1, {
      distance_m: METERS_PER_MILE,
      elapsed_time_s: 600,
      moving_time_s: 480,
    });
    const ride = activity(2, { sport: "ride", distance_m: METERS_PER_MILE, elapsed_time_s: 200 });
    const missing = activity(3, { elapsed_time_s: 300 });
    expect(
      runPaceHistory([run, run, ride, missing], "elapsed", "mi").map(({ pace }) => pace),
    ).toEqual([600]);
    expect(runPaceHistory([run], "moving", "mi")[0]?.pace).toBe(480);
    expect(runPaceHistory([run], "timer", "mi")).toEqual([]);
    expect(isSourceRace(activity(4, { title: "Race day" }))).toBe(false);
    expect(isSourceRace(activity(4, { workout_type: "race" }))).toBe(true);
  });
  test("bounds initial history rendering while totals cover every activity", () => {
    const records = Array.from({ length: 51 }, (_, index) =>
      activity(index + 1, { distance_m: 1000 }),
    );
    const markup = renderToStaticMarkup(
      <FitnessActivityLog objects={records} openObject={() => undefined} />,
    );
    expect(markup.match(/data-activity-object=/g)).toHaveLength(50);
    expect(markup).toContain("Show more activities (50 of 51 shown)");
    expect(markup).toContain("51 of 51 have distance");
    expect(markup).toContain("31.69 mi");
  });
  test("renders source races and separate owner results without mounting collapsed segment tables", () => {
    const record = activity(1, {
      title: "Morning race <script>",
      workout_type: "race",
      distance_m: METERS_PER_MILE + 200,
      elapsed_time_s: 560,
      laps: [
        {
          index: 1,
          distance_m: 1000,
          duration_s: 300,
          timing_basis: "timer",
          provenance: "device lap",
        },
      ],
      splits: [
        {
          index: 1,
          distance_m: 200,
          target_distance_m: METERS_PER_MILE,
          duration_s: 60,
          timing_basis: "elapsed",
          distance_basis: "recorded",
          method: "linear_interpolation",
          provenance: "distance/time samples",
        },
      ],
    });
    record.user = {
      properties: { official_chip_time_s: 550, official_gun_time_s: 555, event_name: "Autumn 2K" },
    };
    const markup = renderToStaticMarkup(
      <FitnessActivityLog objects={[record]} openObject={() => undefined} />,
    );
    expect(markup).toContain("Race · source label");
    expect(markup).toContain("Official result · owner entered");
    expect(markup).toContain("Chip time 9:10");
    expect(markup).toContain("Gun time 9:15");
    expect(markup).toContain("1 calculated splits · 1 recorded laps");
    expect(markup).not.toContain("<table");
    expect(markup).not.toContain("<script>");
  });
});
