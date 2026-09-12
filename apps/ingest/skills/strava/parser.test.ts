import { describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import { validators } from "@rnet/types";
import { parseStravaExport } from "./parser.ts";
import { parseActivitiesCsv } from "./csv.ts";
import { parseFit } from "./fit.ts";
import { parseGpx, parseTcx } from "./xml.ts";
import { calculateMileSplits, MILE_METERS } from "./splits.ts";
import {
  activityCsv,
  CSV_HEADERS,
  exportZip,
  representativeSyntheticExport,
  syntheticFit,
  syntheticGpx,
  syntheticTcx,
} from "./fixtures/synthetic.ts";
import { STRAVA_LIMITS, PARSER_BUDGETS } from "./contracts.ts";
import { verifyStrava } from "./verify.ts";

describe("Strava identified account-export dialect", () => {
  test("preserves large string IDs, quoted titles, source order, missing metrics, and unknown local time", async () => {
    const parsed = await parseStravaExport(
      activityCsv([
        {
          id: "9007199254740993123",
          title: 'Recovery, "easy"\nrun',
          distance: "",
          elapsed: "",
          moving: "",
          manual: "true",
        },
        { id: "7", sport: "Trail Run" },
        { id: "8", sport: "Walk" },
      ]),
    );
    expect(parsed.activities.map((activity) => activity.id)).toEqual(["9007199254740993123", "7"]);
    expect(parsed.activities[0]!.properties).toMatchObject({
      title: 'Recovery, "easy"\nrun',
      started_local: "2026-09-01T06:00:00",
      strava: { manual: true, detail_status: "summary_only" },
    });
    expect(parsed.activities[0]!.properties.started_at).toBeUndefined();
    expect(parsed.activities[0]!.properties.distance_m).toBeUndefined();
    expect(parsed.activities[0]!.properties.elapsed_time_s).toBeUndefined();
    expect(parsed.excludedBySport).toEqual({ Walk: 1 });
    expect(verifyStrava(parsed).ok).toBe(true);
  });

  test("selects the second SI distance column and never guesses the display column's units", async () => {
    const parsed = await parseStravaExport(
      activityCsv([{ distance: "1609.344", date: "2026-09-01T06:00:00-04:00" }]),
    );
    expect(parsed.activities[0]!.properties.distance_m).toBe(MILE_METERS);
    expect(parsed.activities[0]!.properties.started_at).toBe("2026-09-01T10:00:00.000Z");
    expect(parsed.activities[0]!.properties.splits).toBeUndefined();
  });

  test("fails closed on unsupported headers, ambiguous duplicate metrics, units, dates, and IDs", async () => {
    const invalid: Array<[Uint8Array, RegExp]> = [
      [new TextEncoder().encode("date,distance,pace\n2026-01-01,5,8"), /Unsupported/],
      [
        activityCsv(
          [{}],
          CSV_HEADERS.map((value, index) => (index === 16 ? "Distance (mi)" : value)),
        ),
        /expected 2 Distance/,
      ],
      [activityCsv([{ distance: "3,218.68" }]), /nonnegative decimal/],
      [activityCsv([{ distance: "-2" }]), /nonnegative decimal/],
      [activityCsv([{ date: "Feb 30, 2026, 6:00:00 AM" }]), /invalid calendar/],
      [activityCsv([{ id: "1" }, { id: "1" }]), /duplicate Activity ID/],
      [activityCsv([{ filename: "activities/../secret.fit" }]), /unsafe original/],
      [
        activityCsv([
          { id: "1", filename: "activities/a.fit" },
          { id: "2", filename: "activities/a.fit" },
        ]),
        /reuses an original/,
      ],
      [activityCsv([{ moving: "1300", elapsed: "1200" }]), /moving time exceeds/],
    ];
    for (const [bytes, error] of invalid)
      await expect(parseStravaExport(bytes)).rejects.toThrow(error);
    expect(() =>
      parseActivitiesCsv(new TextDecoder().decode(activityCsv([{}])).replace('"Sep', '""Sep')),
    ).toThrow(/quoting/);
  });
});

describe("Strava original activity evidence", () => {
  test("truncated FIT/TCX samples do not masquerade as complete splits, while excess distance fails", async () => {
    const tcx = await parseStravaExport(
      await exportZip(
        [{ filename: "activities/a.tcx", distance: "5000", elapsed: "1500", moving: "1500" }],
        {
          "activities/a.tcx": syntheticTcx({
            distance: 5000,
            timer: 1500,
            samples: [
              [0, 0],
              [1000, 300],
            ],
          }),
        },
      ),
    );
    expect(tcx.activities[0]!.properties.strava.detail_status).toBe("laps_only");
    expect(tcx.activities[0]!.properties.splits).toBeUndefined();
    const fit = await parseStravaExport(
      await exportZip(
        [{ filename: "activities/a.fit", distance: "5000", elapsed: "1260", moving: "1200" }],
        { "activities/a.fit": syntheticFit({ distance: 5000 }) },
      ),
    );
    expect(fit.activities[0]!.properties.strava.detail_status).toBe("laps_only");
    expect(fit.activities[0]!.properties.splits).toBeUndefined();
    expect(() => calculateMileSplits(parseFit(syntheticFit({ distance: 1000 })))).toThrow(
      /sample distance exceeds/,
    );
    expect(() => calculateMileSplits(parseTcx(syntheticTcx({ distance: 1000 })))).toThrow(
      /sample distance exceeds/,
    );
  });

  test("optional missing GPX times preserve the summary and disclose unavailable splits", async () => {
    const untimed = new TextEncoder().encode(
      new TextDecoder().decode(syntheticGpx()).replace(/<time>[^<]+<\/time>/g, ""),
    );
    const parsed = await parseStravaExport(
      await exportZip([{ filename: "activities/a.gpx", distance: "3113.462" }], {
        "activities/a.gpx": untimed,
      }),
    );
    expect(parsed.activities[0]!.properties.strava.detail_status).toBe("no_distance_samples");
    expect(parsed.activities[0]!.properties.started_at).toBeUndefined();
    expect(parsed.activities[0]!.properties.splits).toBeUndefined();
    expect(() =>
      parseGpx(
        new TextEncoder().encode(
          new TextDecoder()
            .decode(syntheticGpx())
            .replace(/<time>[^<]+<\/time>/, "<time>nonsense</time>"),
        ),
      ),
    ).toThrow(/invalid instant/);
  });

  test("TCX counts trackpoints without distance toward its sample ceiling", () => {
    const header =
      '<TrainingCenterDatabase><Activities><Activity Sport="Running"><Id>2026-09-01T06:00:00Z</Id><Lap><DistanceMeters>5000</DistanceMeters><TotalTimeSeconds>1500</TotalTimeSeconds><Track>';
    const xml =
      header +
      "<Trackpoint><Time>2026-09-01T06:00:00Z</Time></Trackpoint>".repeat(
        PARSER_BUDGETS.samples + 1,
      ) +
      "</Track></Lap></Activity></Activities></TrainingCenterDatabase>";
    expect(() => parseTcx(new TextEncoder().encode(xml))).toThrow(/sample limit/);
  });
  test("final full and partial miles retain trailing stationary time and conserve sampled duration", () => {
    for (const distance of [MILE_METERS, MILE_METERS * 1.5]) {
      const detail = parseTcx(
        syntheticTcx({
          samples: [
            [0, 0],
            [distance, 600],
            [distance, 660],
          ],
          distance,
          timer: 600,
        }),
      );
      const splits = calculateMileSplits(detail);
      expect(splits.reduce((sum, split) => sum + split.duration_s, 0)).toBe(660);
      expect(splits.reduce((sum, split) => sum + split.distance_m, 0)).toBe(distance);
    }
  });
  test("accounts for every run and other sport, retaining FIT, TCX, GPX, manual and missing-detail records", async () => {
    const parsed = await parseStravaExport(await representativeSyntheticExport());
    expect(parsed.sourceRecordCount).toBe(6);
    expect(parsed.activities).toHaveLength(5);
    expect(parsed.excludedBySport).toEqual({ Ride: 1 });
    expect(parsed.activities.map((activity) => activity.properties.strava.detail_status)).toEqual([
      "splits",
      "splits",
      "missing",
      "missing",
      "splits",
    ]);
    expect(
      parsed.activities.every((activity) => validators.fitness_activity(activity.properties)),
    ).toBe(true);
    expect(parsed.activities[1]!.properties.workout_type).toBe("race");
    const verify = verifyStrava(parsed);
    expect(verify.ok).toBe(true);
    expect(verify.source_record_count).toBe(6);
    expect(verify.candidate_count).toBe(5);
    expect(verify.checks.find((check) => check.name === "detail_coverage")!.detail).toContain(
      "3 runs with calculated mile splits",
    );
  });

  test("TCX retains actual device laps and elapsed mile splits including a pause and final half mile", () => {
    const detail = parseTcx(syntheticTcx());
    expect(detail.laps).toMatchObject([
      { distance_m: 4023.36, duration_s: 1500, timing_basis: "timer" },
    ]);
    const splits = calculateMileSplits(detail);
    expect(splits.map((split) => split.distance_m)).toEqual([
      MILE_METERS,
      MILE_METERS,
      MILE_METERS / 2,
    ]);
    expect(splits.map((split) => split.duration_s)).toEqual([600, 660, 300]);
    expect(
      splits.every(
        (split) => split.timing_basis === "elapsed" && split.distance_basis === "recorded",
      ),
    ).toBe(true);
  });

  test("FIT timer events subtract recorded pauses; absent timer events use elapsed explicitly", () => {
    const timer = calculateMileSplits(parseFit(syntheticFit()));
    expect(timer[0]!.duration_s).toBeCloseTo(600, 1);
    expect(timer[1]!.duration_s).toBeCloseTo(600, 1);
    expect(timer.every((split) => split.timing_basis === "timer")).toBe(true);
    const elapsed = calculateMileSplits(parseFit(syntheticFit({ withEvents: false })));
    expect(elapsed.every((split) => split.timing_basis === "elapsed")).toBe(true);
    expect(elapsed.reduce((sum, split) => sum + split.duration_s, 0)).toBeCloseTo(1260, 3);
    const corrupt = syntheticFit();
    corrupt[corrupt.length - 1]! ^= 1;
    expect(() => parseFit(corrupt)).toThrow(/CRC/);
  });

  test("GPX GPS fallback discloses its distance basis and never bridges segment discontinuities", () => {
    const gpx = syntheticGpx(),
      detail = parseGpx(gpx);
    expect(detail.distanceM).toBeCloseTo(3113.4622465, 4);
    expect(
      calculateMileSplits(detail).every(
        (split) => split.distance_basis === "gps" && split.timing_basis === "elapsed",
      ),
    ).toBe(true);
    const text = new TextDecoder()
      .decode(gpx)
      .replace('</trkpt><trkpt lat="0.014"', '</trkpt></trkseg><trkseg><trkpt lat="0.014"');
    expect(calculateMileSplits(parseGpx(new TextEncoder().encode(text)))).toEqual([]);
  });

  test("rejects conflicting originals instead of attaching another run's splits", async () => {
    await expect(
      parseStravaExport(
        await exportZip([{ filename: "activities/a.fit" }], {
          "activities/a.fit": syntheticFit({ start: "2026-09-03T06:00:00Z" }),
        }),
      ),
    ).rejects.toThrow(/start time conflicts/);
    await expect(
      parseStravaExport(
        await exportZip([{ filename: "activities/a.tcx", distance: "50000" }], {
          "activities/a.tcx": syntheticTcx(),
        }),
      ),
    ).rejects.toThrow(/distance conflicts/);
    await expect(
      parseStravaExport(
        await exportZip([{ filename: "activities/a.tcx" }], {
          "activities/a.tcx": new TextEncoder().encode("<bad>"),
        }),
      ),
    ).rejects.toThrow(/Malformed activity XML/);
  });

  test("leaves splits unavailable without distance evidence, but rejects decreasing and impossible samples", () => {
    const detail = parseTcx(
      syntheticTcx({
        samples: [
          [100, 0],
          [1000, 300],
        ],
      }),
    );
    expect(calculateMileSplits(detail)).toEqual([]);
    expect(() =>
      calculateMileSplits(
        parseTcx(
          syntheticTcx({
            samples: [
              [0, 0],
              [1000, 300],
              [500, 600],
            ],
          }),
        ),
      ),
    ).toThrow(/inconsistent/);
    expect(() =>
      calculateMileSplits(
        parseTcx(
          syntheticTcx({
            samples: [
              [0, 0],
              [1000, 0],
            ],
          }),
        ),
      ),
    ).toThrow(/inconsistent/);
  });

  test("reads only referenced recognized originals with one optional gzip layer and an optional archive prefix", async () => {
    const bytes = await exportZip(
      [
        { filename: "activities/a.tcx.gz", distance: "4023.36", elapsed: "1560" },
        { id: "2", filename: "activities/b.pwx" },
      ],
      {
        "activities/a.tcx.gz": new Uint8Array(gzipSync(syntheticTcx())),
        "activities/b.pwx": new Uint8Array([1]),
        "activities/unreferenced.fit": new Uint8Array([0]),
        "account/secret.json": new Uint8Array([0xff]),
      },
      "export_123/",
    );
    const parsed = await parseStravaExport(bytes);
    expect(parsed.activities[0]!.properties.splits).toHaveLength(3);
    expect(parsed.activities[1]!.properties.strava.detail_status).toBe("unsupported");
    const nested = new Uint8Array(gzipSync(gzipSync(syntheticFit())));
    await expect(
      parseStravaExport(
        await exportZip([{ filename: "activities/a.fit.gz" }], { "activities/a.fit.gz": nested }),
      ),
    ).rejects.toThrow(/FIT original failed/);
  });

  test("bounds uploaded bytes, decompression, XML depth/entities, and split output", async () => {
    await expect(
      parseStravaExport(new Uint8Array(STRAVA_LIMITS.maxCaptureBytes + 1)),
    ).rejects.toThrow(/capture limit/);
    const bomb = new Uint8Array(gzipSync(new Uint8Array(PARSER_BUDGETS.originalBytes + 1)));
    await expect(
      parseStravaExport(
        await exportZip([{ filename: "activities/a.fit.gz" }], { "activities/a.fit.gz": bomb }),
      ),
    ).rejects.toThrow();
    expect(() =>
      parseTcx(
        new TextEncoder().encode(
          '<!DOCTYPE x [<!ENTITY x SYSTEM "https://evil.invalid/secret">]><x>&x;</x>',
        ),
      ),
    ).toThrow(/DTDs or entities/);
    expect(() => parseTcx(new TextEncoder().encode("<x>".repeat(34) + "</x>".repeat(34)))).toThrow(
      /nesting limit/,
    );
    expect(() =>
      calculateMileSplits({
        ...parseTcx(syntheticTcx()),
        distanceM: MILE_METERS * 1001,
        elapsedS: 50000,
        samples: [
          { distanceM: 0, elapsedS: 0 },
          { distanceM: MILE_METERS * 1001, elapsedS: 50000 },
        ],
      }),
    ).toThrow(/split count limit/);
  });
});
