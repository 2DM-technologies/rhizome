import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, rm } from "node:fs/promises";
import { expect, test } from "@rhizome/test-support/playwright";
import { createReviewedFileSkillConformance } from "@rhizome/test-support/reviewedFileSkillConformance";
import { representativeSyntheticExport } from "../fixtures/synthetic.ts";
import { mockStravaSkill } from "./support/mockStravaSkill.ts";

const filename = `strava-synthetic-${process.pid}.zip`;
const fixture = join(tmpdir(), filename);
const conformance = createReviewedFileSkillConformance({
  adapter: mockStravaSkill,
  candidateCount: 5,
  sourceRecordCount: 6,
  candidateLabel: "activities",
  fixtureFilename: filename,
  fixturePath: fixture,
  total: "No aggregate totals",
  verifyCheckCount: 6,
});
test.beforeAll(async () => {
  await writeFile(fixture, await representativeSyntheticExport());
});
test.afterAll(async () => {
  await rm(fixture, { force: true });
});

test("Strava ZIP review accounts for excluded sports and opens the fitness log after confirmation", async ({
  page,
}) => {
  const store = await conformance.install(page);
  store.vibes[0]!.objects = [];
  await conformance.confirm(page, store);
  await expect(page.locator('[data-vibe-view="fitness_log"]')).toBeVisible();
  await expect(page.getByText("Paused long run", { exact: true })).toBeVisible();
  expect(
    [...store.objects.values()].filter((object) => object.type === "fitness_activity"),
  ).toHaveLength(5);
  expect(
    [...store.objects.values()]
      .filter((object) => object.type === "fitness_activity")
      .every((object) => object.elements.length === 0),
  ).toBe(true);
});
test("canceling the parsed Strava ZIP preserves raw origin without derived writes", async ({
  page,
}) => {
  const store = await conformance.install(page);
  await conformance.cancel(page, store);
});
test("unsupported Strava selection fails before uploading", async ({ page }) => {
  const store = await conformance.install(page);
  await conformance.rejectUnsupportedFile(page, store);
});
