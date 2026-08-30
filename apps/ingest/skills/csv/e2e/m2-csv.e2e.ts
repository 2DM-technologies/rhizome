import { fileURLToPath } from "node:url";

import { test } from "../../../../host/e2e/support/playwright.ts";
import { createReviewedFileSkillConformance } from "../../../../host/e2e/support/reviewedFileSkillConformance.ts";

import { mockCsvSourceSkill } from "./support/mockCsvSkill.ts";

const conformance = createReviewedFileSkillConformance({
  adapter: mockCsvSourceSkill,
  candidateCount: 3,
  fixtureFilename: "rhizome-bank.csv",
  fixturePath: fileURLToPath(new URL("../fixtures/rhizome-bank.csv", import.meta.url)),
  total: "USD 2410.25",
  verifyCheckCount: 5,
});

test.describe("CSV reviewed file source", () => {
  let mockStore: Awaited<ReturnType<typeof conformance.install>>;

  test.beforeEach(async ({ page }) => {
    mockStore = await conformance.install(page);
  });

  test("stages from its fixture and refreshes membership only after confirm", async ({ page }) => {
    await conformance.confirm(page, mockStore);
  });

  test("cancel preserves raw records without committing candidates", async ({ page }) => {
    await conformance.cancel(page, mockStore);
  });

  test("rejects an unsupported file before uploading an origin", async ({ page }) => {
    await conformance.rejectUnsupportedFile(page, mockStore);
  });
});
