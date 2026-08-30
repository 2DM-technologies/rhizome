import { expect, test, type Page } from "@playwright/test";

import {
  COMPROMISED_SIMPLEFIN_TOKEN,
  SIMPLEFIN_CREDENTIAL_ID,
  VIBE_ID,
  installMockStore,
  type MockStore,
} from "./support/mockStore.ts";

const VALID_SETUP_TOKEN = "valid-one-time-simplefin-setup-token";

let mockStore: MockStore;

test.beforeEach(async ({ page }) => {
  mockStore = await installMockStore(page);
  const target = mockStore.vibes[0];
  if (!target) throw new Error("Missing mocked target Vibe");
  delete target.pull;
});

async function stageSimpleFin(page: Page): Promise<void> {
  await page.goto(`/vibes/${VIBE_ID}`);
  const token = page.getByLabel("SimpleFIN setup token");
  await token.fill(VALID_SETUP_TOKEN);
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  const reconciliation = page.getByLabel("VERIFY reconciliation");
  await expect(reconciliation).toBeVisible();
  await expect(token).toHaveValue("");
  await expect(reconciliation).toContainText("2 transactions passed VERIFY");
  await expect(reconciliation).toContainText("2 source records → 2 candidates");
  await expect(reconciliation).toContainText("USD -91.75");
  await expect(page.getByRole("list", { name: "VERIFY checks" }).getByRole("listitem")).toHaveCount(
    5,
  );
  await expect(page.locator("[data-import-candidate]")).toHaveCount(2);
}

async function configureSimpleFin(page: Page): Promise<string> {
  await stageSimpleFin(page);
  const source = [...mockStore.ingestionSources.values()].find(
    (candidate) => candidate.kind === "credential",
  );
  if (!source) throw new Error("Missing mocked SimpleFIN source");
  await page.getByRole("button", { name: "Confirm import" }).click();
  await expect(page.getByRole("status")).toContainText("Imported 2 transactions from SimpleFIN.");
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
    provider: "simplefin",
    status: "active",
  });
  expect(source).toMatchObject({ kind: "credential", parser: "simplefin", config: {} });
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

  await expect(page.getByRole("status")).toContainText("Imported 2 transactions from SimpleFIN.");
  await expect(page.getByLabel("VERIFY reconciliation")).toHaveCount(0);
  expect(mockStore.vibes[0]?.objects).toHaveLength(initialMembership.length + 2);
  expect(mockStore.objects.size).toBe(initialObjectCount + 2);
  expect(mockStore.vibes[0]?.pull?.sources).toContain(source?.source);
});

test("cancel keeps the SimpleFIN credential, source, and raw response but commits nothing", async ({
  page,
}) => {
  const initialMembership = [...(mockStore.vibes[0]?.objects ?? [])];
  const initialObjectCount = mockStore.objects.size;

  await stageSimpleFin(page);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await expect(page.getByRole("status")).toHaveText(
    "Review canceled. No transactions were imported.",
  );
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
  const token = page.getByLabel("SimpleFIN setup token");
  await token.fill(COMPROMISED_SIMPLEFIN_TOKEN);
  await page.getByRole("button", { name: "Connect", exact: true }).click();

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
  mockStore.failNextPullWithSimpleFinHistoryGap(source);

  await page.getByRole("button", { name: "Refresh sources" }).click();

  await expect(
    page.getByText(
      "The previous connected balance cannot be reconciled inside SimpleFIN's history window.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review new baseline" }).click();

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
  expect(previewRequests.at(-1)?.postDataJSON()).toEqual({ source, rebaseline: true });

  await page.getByRole("button", { name: "Confirm import" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Imported 2 transactions from SimpleFIN history recovery.",
  );
});

test("an owner can review recovery discovered by a failed polled pull", async ({ page }) => {
  const source = await configureSimpleFin(page);
  mockStore.failNextPullWithUnreconciledSimpleFinActivity(source);

  await page.getByRole("button", { name: "Refresh sources" }).click();

  await expect(
    page.getByText(
      "The connected account balances cannot be reconciled with the returned transaction history.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review new baseline" }).click();

  await expect(page.getByLabel("VERIFY reconciliation")).toBeVisible();
  const previewRequests = mockStore.requests.filter(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === `/rnet/v0/vibes/${VIBE_ID}/imports`,
  );
  expect(previewRequests.at(-1)?.postDataJSON()).toEqual({ source, rebaseline: true });
});

test("history recovery stays hidden for redacted or unconfigured source metadata", async ({
  page,
}) => {
  await configureSimpleFin(page);

  mockStore.failNextPullWithSimpleFinHistoryGap(null);
  await page.getByRole("button", { name: "Refresh sources" }).click();
  await expect(
    page.getByText(
      "The previous connected balance cannot be reconciled inside SimpleFIN's history window.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Review new baseline" })).toHaveCount(0);

  mockStore.failNextPullWithSimpleFinHistoryGap(`source:${VIBE_ID}`);
  await page.getByRole("button", { name: "Refresh sources" }).click();
  await expect(
    page.getByText(
      "The previous connected balance cannot be reconciled inside SimpleFIN's history window.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Review new baseline" })).toHaveCount(0);

  mockStore.failNextPullWithUnreconciledSimpleFinActivity(null);
  await page.getByRole("button", { name: "Refresh sources" }).click();
  await expect(
    page.getByText(
      "The connected account balances cannot be reconciled with the returned transaction history.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Review new baseline" })).toHaveCount(0);

  mockStore.failNextPullWithUnreconciledSimpleFinActivity(`source:${VIBE_ID}`);
  await page.getByRole("button", { name: "Refresh sources" }).click();
  await expect(
    page.getByText(
      "The connected account balances cannot be reconciled with the returned transaction history.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Review new baseline" })).toHaveCount(0);
});
