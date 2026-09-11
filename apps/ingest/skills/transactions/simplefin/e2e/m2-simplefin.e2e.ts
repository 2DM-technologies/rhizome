import { expect, test, type Page } from "../../../../../host/e2e/support/playwright.ts";

import {
  VIBE_ID,
  installMockStore,
  runCredentialedSkillMockConformance,
  type MockStore,
} from "../../../../../host/e2e/support/mockStore.ts";
import {
  COMPROMISED_SIMPLEFIN_TOKEN,
  SIMPLEFIN_CREDENTIAL_ID,
  mockSimpleFinSourceSkill,
} from "./support/mockSimpleFinSkill.ts";

const VALID_SETUP_TOKEN = "valid-one-time-simplefin-setup-token";

let mockStore: MockStore;

test.beforeEach(async ({ page }) => {
  mockStore = await installMockStore(page, { sourceSkills: [mockSimpleFinSourceSkill] });
  const target = mockStore.vibes[0];
  if (!target) throw new Error("Missing mocked target Vibe");
  delete target.pull;
});

test("the SimpleFIN browser adapter satisfies credentialed-source conformance", async () => {
  await runCredentialedSkillMockConformance({
    adapter: mockSimpleFinSourceSkill,
    invalidConnectionInput: { setup_token: "" },
    validConnectionInput: { setup_token: VALID_SETUP_TOKEN },
  });
});

async function stageSimpleFin(page: Page): Promise<void> {
  await page.goto(`/vibes/${VIBE_ID}`);
  await page.getByRole("button", { name: "Import into this Vibe", exact: true }).click();
  await page.getByLabel("Import source", { exact: true }).selectOption({ label: "SimpleFIN" });
  const token = page.getByLabel("SimpleFIN setup token");
  await token.fill(VALID_SETUP_TOKEN);
  await page.getByRole("button", { name: "Review SimpleFIN", exact: true }).click();

  const reconciliation = page.getByLabel("VERIFY reconciliation");
  await expect(reconciliation).toBeVisible();
  await expect(token).toHaveValue("");
  await expect(reconciliation).toContainText("3 transactions passed VERIFY");
  await expect(reconciliation).toContainText("3 source records → 3 candidates");
  await expect(reconciliation).toContainText("USD 120.50");
  await expect(page.getByRole("list", { name: "VERIFY checks" }).getByRole("listitem")).toHaveCount(
    7,
  );
  await expect(page.locator("[data-import-candidate]")).toHaveCount(3);
}

async function configureSimpleFin(page: Page): Promise<string> {
  await stageSimpleFin(page);
  const source = [...mockStore.ingestionSources.values()].find(
    (candidate) => candidate.kind === "credential",
  );
  if (!source) throw new Error("Missing mocked SimpleFIN source");
  await page.getByRole("button", { name: "Confirm import" }).click();
  await expect(page.getByRole("status")).toContainText("Imported 3 transactions from SimpleFIN.");
  return source.source;
}

test("SimpleFIN stages a secret-free reviewed import and commits only after confirm", async ({
  page,
}) => {
  const initialMembership = [...(mockStore.vibes[0]?.objects ?? [])];
  const initialObjectCount = mockStore.objects.size;

  await stageSimpleFin(page);

  expect(mockStore.vibes[0]?.objects).toEqual(initialMembership);
  expect(mockStore.objects.size).toBe(initialObjectCount);
  expect(mockStore.sourceCredentials.size).toBe(1);
  expect(mockStore.ingestionSources.size).toBe(1);
  expect(mockStore.origins.size).toBe(1);
  const [credential] = [...mockStore.sourceCredentials.values()];
  const [source] = [...mockStore.ingestionSources.values()];
  const [origin] = [...mockStore.origins.values()];
  expect(credential).toMatchObject({
    credential: `credential:${SIMPLEFIN_CREDENTIAL_ID}`,
    skill_id: "simplefin",
    connector_version: "simplefin-connector@1.0.0",
    status: "active",
  });
  expect(source).toMatchObject({
    kind: "credential",
    skill_id: "simplefin",
    connector_version: "simplefin-connector@1.0.0",
    parser: "simplefin",
    config: {},
  });
  expect(origin?.document.mime).toBe("application/json");

  const posts = mockStore.requests.filter((request) => request.method() === "POST");
  expect(posts.map((request) => new URL(request.url()).pathname)).toEqual([
    "/rnet/v0/source-credentials/simplefin",
    "/rnet/v0/ingestion-sources",
    `/rnet/v0/vibes/${VIBE_ID}/imports`,
  ]);
  const requestsContainingToken = posts.filter((request) =>
    (request.postData() ?? "").includes(VALID_SETUP_TOKEN),
  );
  expect(requestsContainingToken).toHaveLength(1);
  expect(new URL(requestsContainingToken[0]?.url() ?? "http://invalid").pathname).toBe(
    "/rnet/v0/source-credentials/simplefin",
  );
  expect(posts[1]?.postDataJSON()).toEqual({
    credential: `credential:${SIMPLEFIN_CREDENTIAL_ID}`,
  });
  expect(posts[2]?.postData()).not.toContain(VALID_SETUP_TOKEN);

  await page.getByRole("button", { name: "Confirm import" }).click();

  await expect(page.getByRole("status")).toContainText("Imported 3 transactions from SimpleFIN.");
  await expect(page.getByLabel("VERIFY reconciliation")).toHaveCount(0);
  expect(mockStore.vibes[0]?.objects).toHaveLength(initialMembership.length + 3);
  expect(mockStore.objects.size).toBe(initialObjectCount + 3);
  expect(mockStore.vibes[0]?.pull?.sources).toContain(source?.source);
});

test("cancel keeps the SimpleFIN credential, source, and raw response but commits nothing", async ({
  page,
}) => {
  const initialMembership = [...(mockStore.vibes[0]?.objects ?? [])];
  const initialObjectCount = mockStore.objects.size;

  await stageSimpleFin(page);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await expect(page.getByRole("status")).toHaveText("Review canceled. Nothing was imported.");
  await expect(page.getByLabel("VERIFY reconciliation")).toHaveCount(0);
  expect(mockStore.vibes[0]?.objects).toEqual(initialMembership);
  expect(mockStore.objects.size).toBe(initialObjectCount);
  expect(mockStore.sourceCredentials.size).toBe(1);
  expect(mockStore.ingestionSources.size).toBe(1);
  expect(mockStore.origins.size).toBe(1);
  expect(
    mockStore.requests.filter(
      (request) =>
        request.method() === "POST" && new URL(request.url()).pathname.endsWith("/confirm"),
    ),
  ).toHaveLength(0);
});

test("a rejected compromised token is cleared and its disable warning stops the flow", async ({
  page,
}) => {
  await page.goto(`/vibes/${VIBE_ID}`);
  await page.getByRole("button", { name: "Import into this Vibe", exact: true }).click();
  await page.getByLabel("Import source", { exact: true }).selectOption({ label: "SimpleFIN" });
  const token = page.getByLabel("SimpleFIN setup token");
  await token.fill(COMPROMISED_SIMPLEFIN_TOKEN);
  await page.getByRole("button", { name: "Review SimpleFIN", exact: true }).click();

  await expect(token).toHaveValue("");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("may be compromised");
  await expect(alert).toContainText("disable it in SimpleFIN Bridge");
  expect(mockStore.sourceCredentials.size).toBe(0);
  expect(mockStore.ingestionSources.size).toBe(0);
  expect(mockStore.origins.size).toBe(0);
  expect(
    mockStore.requests
      .filter((request) => request.method() === "POST")
      .map((request) => new URL(request.url()).pathname),
  ).toEqual(["/rnet/v0/source-credentials/simplefin"]);
});

test("an owner can review and confirm a configured SimpleFIN history recovery", async ({
  page,
}) => {
  const source = await configureSimpleFin(page);
  mockStore.requireNextSourceAction({
    skillId: "simplefin",
    source,
    timing: "pull_problem",
  });

  await page.getByRole("button", { name: "Refresh sources" }).click();

  await expect(
    page.getByText(
      "The previous connected balance cannot be reconciled inside SimpleFIN's history window.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review import" }).last().click();

  const reconciliation = page.getByLabel("VERIFY reconciliation");
  await expect(reconciliation).toBeVisible();
  const recoveryCheck = reconciliation.locator('[data-verify-check="history_recovery"]');
  await expect(recoveryCheck).toContainText("Owner-reviewed rebaseline resumes connected history");
  await expect(page.getByRole("button", { name: "Confirm import" })).toBeEnabled();

  const previewRequests = mockStore.requests.filter(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === `/rnet/v0/vibes/${VIBE_ID}/imports`,
  );
  expect(previewRequests.at(-1)?.postDataJSON()).toEqual({
    source,
    continuation_token: expect.stringMatching(/^mock-continuation-\S{32,}$/),
  });

  await page.getByRole("button", { name: "Confirm import" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Imported 3 transactions from SimpleFIN history needs a new baseline.",
  );
});

test("an owner can review recovery discovered by a failed polled pull", async ({ page }) => {
  const source = await configureSimpleFin(page);
  mockStore.requireNextSourceAction({
    skillId: "simplefin",
    source,
    timing: "polled_operation",
  });

  await page.getByRole("button", { name: "Refresh sources" }).click();

  await expect(
    page.getByText(
      "The connected account balances cannot be reconciled with the returned transaction history.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review import" }).last().click();

  await expect(page.getByLabel("VERIFY reconciliation")).toBeVisible();
  const previewRequests = mockStore.requests.filter(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === `/rnet/v0/vibes/${VIBE_ID}/imports`,
  );
  expect(previewRequests.at(-1)?.postDataJSON()).toEqual({
    source,
    continuation_token: expect.stringMatching(/^mock-continuation-\S{32,}$/),
  });
});

test("history recovery stays hidden for redacted or unconfigured source metadata", async ({
  page,
}) => {
  await configureSimpleFin(page);

  mockStore.requireNextSourceAction({
    skillId: "simplefin",
    source: null,
    timing: "pull_problem",
  });
  await page.getByRole("button", { name: "Refresh sources" }).click();
  await expect(
    page.getByText("The connected source owner must review an import before pulling again."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Review import" })).toHaveCount(0);

  mockStore.requireNextSourceAction({
    skillId: "simplefin",
    source: `source:${VIBE_ID}`,
    timing: "pull_problem",
  });
  await page.getByRole("button", { name: "Refresh sources" }).click();
  await expect(
    page.getByText(
      "The previous connected balance cannot be reconciled inside SimpleFIN's history window.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Review import" })).toHaveCount(0);

  mockStore.requireNextSourceAction({
    skillId: "simplefin",
    source: null,
    timing: "polled_operation",
  });
  await page.getByRole("button", { name: "Refresh sources" }).click();
  await expect(
    page.getByText("The connected source owner must review an import before pulling again."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Review import" })).toHaveCount(0);

  mockStore.requireNextSourceAction({
    skillId: "simplefin",
    source: `source:${VIBE_ID}`,
    timing: "polled_operation",
  });
  await page.getByRole("button", { name: "Refresh sources" }).click();
  await expect(
    page.getByText(
      "The connected account balances cannot be reconciled with the returned transaction history.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Review import" })).toHaveCount(0);
});
