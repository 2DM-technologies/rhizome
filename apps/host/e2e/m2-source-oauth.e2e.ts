import { expect, test, type Page, type Request } from "@playwright/test";

import { VIBE_ID, installMockStore, type MockStore } from "./support/mockStore.ts";
import {
  SYNTHETIC_OAUTH_AUTHORIZATION_CODE,
  SYNTHETIC_OAUTH_AUTHORIZATION_ENDPOINT,
  SYNTHETIC_OAUTH_BUTTON_LABEL,
  SYNTHETIC_OAUTH_CREDENTIAL_ID,
  SYNTHETIC_OAUTH_SKILL_LABEL,
  mockSyntheticOAuthSourceSkill,
} from "./support/syntheticSourceSkills.ts";

let mockStore: MockStore;

test.beforeEach(async ({ page }) => {
  mockStore = await installMockStore(page, { sourceSkills: [mockSyntheticOAuthSourceSkill] });
  const target = mockStore.vibes[0];
  if (!target) throw new Error("Missing mocked target Vibe");
  delete target.pull;
});

function requestsTo(pathname: string, method?: string): Request[] {
  return mockStore.requests.filter((request) => {
    const url = new URL(request.url());
    return url.pathname === pathname && (!method || request.method() === method);
  });
}

function postsTo(pathname: string): Request[] {
  return requestsTo(pathname, "POST");
}

async function selectAndConnect(page: Page): Promise<void> {
  await page
    .getByLabel("Import source", { exact: true })
    .selectOption({ label: SYNTHETIC_OAUTH_SKILL_LABEL });
  await page.getByRole("button", { name: SYNTHETIC_OAUTH_BUTTON_LABEL, exact: true }).click();
}

async function expectSyntheticReview(page: Page): Promise<void> {
  const reconciliation = page.getByLabel("VERIFY reconciliation");
  await expect(reconciliation).toBeVisible();
  await expect(reconciliation).toContainText("2 objects passed VERIFY");
  await expect(reconciliation).toContainText("2 source records → 2 candidates");
  await expect(
    page.getByRole("list", { name: "Candidate media objects" }).locator("[data-import-candidate]"),
  ).toHaveCount(2);
}

async function expectCleanBrowserBoundary(page: Page): Promise<void> {
  const browserStorage = await page.evaluate(() => ({
    local: Object.fromEntries(
      Array.from({ length: localStorage.length }, (_, index) => {
        const key = localStorage.key(index) ?? "";
        return [key, localStorage.getItem(key)];
      }),
    ),
    session: Object.fromEntries(
      Array.from({ length: sessionStorage.length }, (_, index) => {
        const key = sessionStorage.key(index) ?? "";
        return [key, sessionStorage.getItem(key)];
      }),
    ),
  }));
  const persistentStorage = await page.context().storageState();
  const storageText = JSON.stringify({ browserStorage, persistentStorage });
  const requestBodies = mockStore.requests.map((request) => request.postData() ?? "").join("\n");
  for (const secret of [SYNTHETIC_OAUTH_AUTHORIZATION_CODE]) {
    expect(storageText).not.toContain(secret);
    expect(requestBodies).not.toContain(secret);
    expect(page.url()).not.toContain(secret);
  }
  const currentUrl = new URL(page.url());
  expect(currentUrl.searchParams.has("source_connection")).toBe(false);
  expect(currentUrl.searchParams.has("code")).toBe(false);
  expect(currentUrl.searchParams.has("state")).toBe(false);
  expect(
    (await page.context().cookies()).filter(({ name }) => name.startsWith("rhizome_oauth_")),
  ).toEqual([]);
}

function expectExactlyOnceConnectionAndPreview(previewPath: string): void {
  const skillId = mockSyntheticOAuthSourceSkill.manifest.skill_id;
  expect(postsTo(`/rnet/v0/source-connections/${skillId}/oauth`)).toHaveLength(1);
  expect(requestsTo("/rnet/v0/source-connections/oauth/callback", "GET")).toHaveLength(1);
  expect(postsTo("/rnet/v0/ingestion-sources")).toHaveLength(1);
  expect(postsTo(previewPath)).toHaveLength(1);
  expect(postsTo("/rnet/v0/ingestion-sources")[0]?.postDataJSON()).toEqual({
    credential: `credential:${SYNTHETIC_OAUTH_CREDENTIAL_ID}`,
  });
  expectPkceAuthorization();
}

function expectPkceAuthorization(): void {
  const requests = mockStore.requests.filter((request) =>
    request.url().startsWith(SYNTHETIC_OAUTH_AUTHORIZATION_ENDPOINT),
  );
  expect(requests).toHaveLength(1);
  const authorization = new URL(requests[0]!.url());
  expect(requests[0]!.method()).toBe("GET");
  expect(authorization.searchParams.get("response_type")).toBe("code");
  expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authorization.searchParams.get("code_challenge")).toMatch(/^\S{43,128}$/);
  expect(authorization.searchParams.get("state")).toMatch(/^\S{32,}$/);
  expect(authorization.searchParams.get("redirect_uri")).toMatch(
    /\/rnet\/v0\/source-connections\/oauth\/callback$/,
  );
  const callback = requestsTo("/rnet/v0/source-connections/oauth/callback", "GET")[0];
  expect(callback?.headers()["cookie"]).toMatch(
    /(?:^|;\s*)rhizome_oauth_[0-9a-f-]{36}=\S{43}(?:;|$)/,
  );
}

test("generic OAuth resumes a new destination exactly once after a full-page provider redirect", async ({
  page,
}) => {
  await page.goto("/imports");
  await page.getByRole("button", { name: "Import into a new Vibe" }).click();
  await selectAndConnect(page);

  await expectSyntheticReview(page);
  await expect(page).toHaveURL(/\/imports$/);
  expectExactlyOnceConnectionAndPreview("/rnet/v0/imports");
  expect(
    mockStore.sourceCredentials.get(`credential:${SYNTHETIC_OAUTH_CREDENTIAL_ID}`),
  ).toMatchObject({
    skill_id: mockSyntheticOAuthSourceSkill.manifest.skill_id,
    status: "active",
  });
  expect([...mockStore.sourceConnectionAttempts.values()]).toEqual([
    expect.objectContaining({
      skill_id: mockSyntheticOAuthSourceSkill.manifest.skill_id,
      status: "succeeded",
      intent: { kind: "review_import", destination: { kind: "new_vibe" } },
      credential: `credential:${SYNTHETIC_OAUTH_CREDENTIAL_ID}`,
    }),
  ]);
  await expectCleanBrowserBoundary(page);

  await page.getByRole("button", { name: "Confirm import" }).click();
  await expect(page.getByText("Target Vibe: Imported objects", { exact: true })).toBeVisible();

  // Consuming the return marker must survive an ImportPanel lifecycle, not merely its first
  // React mount. Otherwise the retained attempt would stage a duplicate on remount.
  await page.getByRole("button", { name: "Choose another Vibe" }).click();
  await page.getByRole("button", { name: "Import into a new Vibe" }).click();
  await expect(
    page.getByRole("button", { name: SYNTHETIC_OAUTH_BUTTON_LABEL, exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("VERIFY reconciliation")).toHaveCount(0);
  expect(postsTo("/rnet/v0/ingestion-sources")).toHaveLength(1);
  expect(postsTo("/rnet/v0/imports")).toHaveLength(1);
});

test("generic OAuth restores an existing destination and stages its source exactly once", async ({
  page,
}) => {
  await page.goto(`/vibes/${VIBE_ID}`);
  await selectAndConnect(page);

  await expectSyntheticReview(page);
  await expect(page).toHaveURL(new RegExp(`/vibes/${VIBE_ID}$`));
  expectExactlyOnceConnectionAndPreview(`/rnet/v0/vibes/${VIBE_ID}/imports`);
  expect([...mockStore.sourceConnectionAttempts.values()]).toEqual([
    expect.objectContaining({
      status: "succeeded",
      intent: {
        kind: "review_import",
        destination: { kind: "existing_vibe", id: `rnet://vibe/${VIBE_ID}` },
      },
    }),
  ]);
  await expectCleanBrowserBoundary(page);
});

test("a consumed OAuth return cannot replay after the new-destination panel remounts", async ({
  page,
}) => {
  await page.goto("/imports");
  await page.getByRole("button", { name: "Import into a new Vibe" }).click();
  await selectAndConnect(page);
  await expectSyntheticReview(page);
  expectExactlyOnceConnectionAndPreview("/rnet/v0/imports");

  await page.getByRole("button", { name: "Choose another Vibe" }).click();
  await page.getByRole("button", { name: "Import into a new Vibe" }).click();
  await expect(page.getByLabel("Import source", { exact: true })).toBeVisible();
  await page.waitForTimeout(100);

  expect(postsTo("/rnet/v0/ingestion-sources")).toHaveLength(1);
  expect(postsTo("/rnet/v0/imports")).toHaveLength(1);
});

test("a provider denial is terminal, cleans the callback URL, and never creates a source", async ({
  page,
}) => {
  mockStore.rejectNextOAuthConnection();
  await page.goto(`/vibes/${VIBE_ID}`);
  await selectAndConnect(page);

  await expect(page.getByRole("alert")).toHaveText(
    "The source connection was not approved. Choose the source to try again.",
  );
  await expect(page).toHaveURL(new RegExp(`/vibes/${VIBE_ID}$`));
  expect(
    postsTo(`/rnet/v0/source-connections/${mockSyntheticOAuthSourceSkill.manifest.skill_id}/oauth`),
  ).toHaveLength(1);
  expect(requestsTo("/rnet/v0/source-connections/oauth/callback", "GET")).toHaveLength(1);
  expectPkceAuthorization();
  expect([...mockStore.sourceConnectionAttempts.values()]).toEqual([
    expect.objectContaining({ status: "rejected", error_code: "provider_denied" }),
  ]);
  expect(mockStore.sourceCredentials.size).toBe(0);
  expect(mockStore.ingestionSources.size).toBe(0);
  expect(postsTo(`/rnet/v0/vibes/${VIBE_ID}/imports`)).toHaveLength(0);
  await expectCleanBrowserBoundary(page);
});

test("a sanitized callback failure is recoverable and its URL marker is consumed", async ({
  page,
}) => {
  await page.goto("/imports?source_connection_error=callback_failed");

  await expect(page.getByRole("alert")).toHaveText(
    "The source connection could not be completed. Start the connection again.",
  );
  await expect(page).toHaveURL(/\/imports$/);
  await expect(page.getByRole("button", { name: "Import into a new Vibe" })).toBeVisible();
  await page.getByRole("button", { name: "Import into a new Vibe" }).click();
  await expect(
    page.getByRole("button", { name: SYNTHETIC_OAUTH_BUTTON_LABEL, exact: true }),
  ).toBeVisible();
  expect(mockStore.sourceConnectionAttempts.size).toBe(0);
});

test("a stale connection attempt is recoverable and its URL marker is consumed", async ({
  page,
}) => {
  const staleAttemptId = "0198f2a1-1401-7501-8501-999999999999";
  await page.goto(`/imports?source_connection=${staleAttemptId}`);

  await expect(page.getByRole("alert")).toHaveText(
    "The source connection could not be loaded. Start the connection again.",
  );
  await expect(page).toHaveURL(/\/imports$/);
  await expect(page.getByRole("button", { name: "Import into a new Vibe" })).toBeVisible();
  expect(requestsTo(`/rnet/v0/source-connections/${staleAttemptId}`, "GET").length).toBeGreaterThan(
    0,
  );
  await page.getByRole("button", { name: "Import into a new Vibe" }).click();
  await expect(
    page.getByRole("button", { name: SYNTHETIC_OAUTH_BUTTON_LABEL, exact: true }),
  ).toBeVisible();
  expect(mockStore.ingestionSources.size).toBe(0);
});
