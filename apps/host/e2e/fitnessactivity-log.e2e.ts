import type { MediaObject } from "@rnet/types";
import { expect, test } from "@rhizome/test-support/playwright";
import {
  OBJECT_ID,
  VIBE_ID,
  installMockStore,
  type MockStore,
} from "@rhizome/test-support/mockStore";

const uuid = (index: number) => `0198f2a1-7c3d-7e4b-9f21-${String(index).padStart(12, "0")}`;
let store: MockStore;
function activity(index: number, properties: Record<string, unknown>): MediaObject {
  const record: MediaObject = {
    ...store.objects.get(OBJECT_ID)!,
    uri: `rnet://object/${uuid(index)}`,
    type: "fitness_activity",
    elements: [],
    inferred: {},
    source: {
      ingest: { method: "parser", skill: "fixture@1", reproducible: true },
      origins: [],
      properties: { sport: "run", ...properties },
    },
  };
  store.objects.set(uuid(index), record);
  return record;
}
test.beforeEach(async ({ page }) => {
  store = await installMockStore(page);
  const older = activity(701, {
    title: "Easy morning",
    started_local: "2026-09-07T06:30:00",
    distance_m: 1609.344 * 5,
    elapsed_time_s: 3000,
    moving_time_s: 2700,
  });
  const race = activity(702, {
    title: "Autumn race",
    started_local: "2026-09-12T07:00:00",
    workout_type: "race",
    distance_m: 1609.344 + 200,
    elapsed_time_s: 560,
    moving_time_s: 540,
    laps: [
      { index: 1, distance_m: 1000, duration_s: 300, timing_basis: "timer", provenance: "device" },
    ],
    splits: [
      {
        index: 1,
        target_distance_m: 1609.344,
        distance_m: 1609.344,
        duration_s: 500,
        timing_basis: "elapsed",
        distance_basis: "recorded",
        method: "linear_interpolation",
        provenance: "distance/time samples",
      },
      {
        index: 2,
        target_distance_m: 1609.344,
        distance_m: 200,
        duration_s: 60,
        timing_basis: "elapsed",
        distance_basis: "recorded",
        method: "linear_interpolation",
        provenance: "distance/time samples",
      },
    ],
  });
  race.user = { properties: { official_chip_time_s: 555, event_name: "Autumn 2K" } };
  const manual = activity(703, {
    title: "Indoor run",
    started_local: "2026-09-13T07:00:00",
    elapsed_time_s: 1800,
  });
  store.vibes[0]!.title = "Marathon training";
  store.vibes[0]!.objects = [older.uri, race.uri, manual.uri];
  store.vibes[0]!.inferred = {};
});
for (const width of [1280, 390]) {
  test(`fitness log shows timing bases, partial miles and race annotations at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/vibes/${VIBE_ID}`);
    const log = page.getByLabel("Fitness activity log", { exact: true });
    const rows = log.locator("[data-activity-object]");
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toHaveAttribute(
      "data-activity-object",
      `rnet://object/${uuid(703)}`,
    );
    await expect(log.getByText("2 of 3 have distance", { exact: false })).toBeVisible();
    await expect(rows.first().getByText("Unavailable", { exact: true })).toHaveCount(3);
    await expect(log.getByRole("img", { name: /Elapsed pace history, 2 runs/ })).toBeVisible();
    await log.getByRole("combobox", { name: "Timing basis", exact: true }).selectOption("moving");
    await expect(log.getByRole("img", { name: /Moving pace history, 2 runs/ })).toBeVisible();
    await expect(rows.last().getByText("9:00 / mi", { exact: true })).toBeVisible();
    await log.getByRole("combobox", { name: "Timing basis", exact: true }).selectOption("timer");
    await expect(
      log.getByText("No runs have both distance and timer time for this chart."),
    ).toBeVisible();
    await log.getByRole("combobox", { name: "Timing basis", exact: true }).selectOption("elapsed");
    await log.getByRole("combobox", { name: "Activities", exact: true }).selectOption("races");
    await expect(rows).toHaveCount(1);
    await expect(rows.first().getByText("Race · source label", { exact: true })).toBeVisible();
    await expect(rows.first().getByLabel("Owner-entered official result")).toContainText(
      "Chip time 9:15",
    );
    await expect(rows.first().locator("table")).toHaveCount(0);
    await rows.first().locator("summary").click();
    await expect(
      rows.first().getByRole("table", { name: "Calculated distance splits" }),
    ).toBeVisible();
    await expect(rows.first().getByRole("table", { name: "Recorded laps" })).toBeVisible();
    await expect(rows.first().getByText("2 · partial", { exact: true })).toBeVisible();
    await expect(rows.first().getByText("0.12 mi", { exact: true })).toBeVisible();
    await log.getByRole("combobox", { name: "Distance", exact: true }).selectOption("km");
    await expect(rows.first().getByText("0.20 km", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await log.getByRole("combobox", { name: "Distance", exact: true }).selectOption("mi");
    await log.getByRole("combobox", { name: "Timing basis", exact: true }).selectOption("elapsed");
    await log.getByRole("combobox", { name: "Activities", exact: true }).selectOption("all");
    await expect(rows).toHaveCount(3);
    await log
      .getByRole("heading", { name: "Activity log", exact: true })
      .evaluate((node) => node.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: testInfo.outputPath("fitnessactivity-log.png"), fullPage: true });
    const race = log.locator(`[data-activity-object="rnet://object/${uuid(702)}"]`);
    await race.locator("summary").click();
    await expect(race.getByRole("table", { name: "Calculated distance splits" })).toBeVisible();
    await race.evaluate((node) => node.scrollIntoView({ block: "start" }));
    await page.screenshot({
      path: testInfo.outputPath("fitnessactivity-splits.png"),
      fullPage: true,
    });
    const open = race.getByRole("link", { name: `Open object rnet://object/${uuid(702)}` });
    await expect(open).toHaveAttribute("href", `/objects/${uuid(702)}`);
    await open.focus();
    await open.press("Enter");
    await expect(page).toHaveURL((url) => url.pathname === `/objects/${uuid(702)}`);
    expect(
      store.requests.filter((request) =>
        /\/elements\/[^/]+\/bytes$/.test(new URL(request.url()).pathname),
      ),
    ).toHaveLength(0);
  });
}

test("history pagination leaves totals complete and filters reset the visible page", async ({
  page,
}) => {
  const more = Array.from({ length: 51 }, (_, index) =>
    activity(800 + index, {
      title: `Training run ${index}`,
      started_local: "2026-09-01T06:30:00",
      distance_m: 1000,
      elapsed_time_s: 300,
    }),
  );
  store.vibes[0]!.objects.push(...more.map(({ uri }) => uri));
  await page.goto(`/vibes/${VIBE_ID}`);
  const log = page.getByLabel("Fitness activity log", { exact: true });
  const rows = log.locator("[data-activity-object]");
  await expect(rows).toHaveCount(50);
  await expect(log.getByText("53 of 54 have distance", { exact: false })).toBeVisible();
  await log
    .getByRole("button", { name: "Show more activities (50 of 54 shown)", exact: true })
    .click();
  await expect(rows).toHaveCount(54);
  await expect(log.getByRole("button", { name: /Show more activities/ })).toHaveCount(0);
  await log.getByRole("combobox", { name: "Activities", exact: true }).selectOption("races");
  await expect(rows).toHaveCount(1);
  await log.getByRole("combobox", { name: "Activities", exact: true }).selectOption("all");
  await expect(rows).toHaveCount(50);
});
