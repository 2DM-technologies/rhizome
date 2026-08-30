import { fileURLToPath } from "node:url";

import { test } from "../../../../host/e2e/support/playwright.ts";
import { createReviewedFileSkillConformance } from "../../../../host/e2e/support/reviewedFileSkillConformance.ts";

import { mockOfxSourceSkill } from "./support/mockOfxSkill.ts";

const conformance = createReviewedFileSkillConformance({
  adapter: mockOfxSourceSkill,
  candidateCount: 2,
  fixtureFilename: "checking.qfx",
  fixturePath: fileURLToPath(new URL("../fixtures/checking.qfx", import.meta.url)),
  total: "USD 2493.50",
  verifyCheckCount: 6,
});

test.describe("QFX / OFX reviewed file source", () => {
  let mockStore: Awaited<ReturnType<typeof conformance.install>>;

  test.beforeEach(async ({ page }) => {
    mockStore = await conformance.install(page);
  });

  test("stages from its fixture and refreshes membership only after confirm", async ({ page }) => {
    await conformance.confirm(page, mockStore);
  });
});
