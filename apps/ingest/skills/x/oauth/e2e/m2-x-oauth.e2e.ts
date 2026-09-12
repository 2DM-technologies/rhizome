import { expect, test, type Page } from "../../../../../host/e2e/support/playwright.ts";
import {
  NEW_VIBE_ID,
  installMockStore,
  type MockStore,
} from "../../../../../host/e2e/support/mockStore.ts";
import { xOAuthSourceManifest } from "../manifest.ts";
import {
  X_OAUTH_ACCESS_TOKEN,
  X_OAUTH_AUTHORIZATION_CODE,
  X_OAUTH_AUTHORIZATION_ENDPOINT,
  createMockXOAuthSkill,
  type MockXProvider,
} from "./support/mockXOAuthSkill.ts";
import { X_OAUTH_CAPTURE_MIME } from "../parser.ts";

let mockStore: MockStore;
let provider: MockXProvider;
const X_DISPLAY_NAMES = ["@example_user - Aug 21, 2026", "@example_user - Aug 20, 2026"] as const;

test.beforeEach(async ({ page }) => {
  const mock = createMockXOAuthSkill();
  provider = mock.provider;
  mockStore = await installMockStore(page, { sourceSkills: [mock.adapter] });
  const target = mockStore.vibes[0];
  if (!target) throw new Error("Missing mocked target Vibe");
  delete target.pull;
});

test("X OAuth connects and reviews text and media into a staged new destination exactly once", async ({
  page,
}) => {
  const initialObjects = mockStore.objects.size;
  const initialElements = mockStore.elements.size;

  await page.goto("/imports");
  await page.getByRole("button", { name: "Import into a new Vibe" }).click();
  await selectAndConnect(page);

  const reconciliation = page.getByLabel("VERIFY reconciliation");
  await expect(reconciliation).toContainText("2 objects passed VERIFY");
  await expect(reconciliation).toContainText("4 source records → 2 candidates");
  await expect(reconciliation).toContainText("4 elements staged");
  await expect(page.getByLabel("New Vibe title")).toHaveCount(0);
  const candidateList = page.getByRole("list", { name: "Candidate media objects" });
  await expect(candidateList.locator("[data-import-candidate]")).toHaveCount(2);
  for (const displayName of X_DISPLAY_NAMES) {
    await expect(candidateList.getByText(displayName, { exact: true })).toBeVisible();
  }
  await expect(candidateList.getByText("Untitled tweet", { exact: true })).toHaveCount(0);
  await expect(
    page
      .getByRole("list", { name: "Candidate media objects" })
      .locator('[data-element-presentation="image"]'),
  ).toBeVisible();
  await expect(
    page
      .getByRole("list", { name: "Candidate media objects" })
      .locator('[data-element-presentation="video"]'),
  ).toBeVisible();
  expect(mockStore.vibes.some(({ uri }) => uri.endsWith(`/${NEW_VIBE_ID}`))).toBe(false);
  expect(mockStore.objects.size).toBe(initialObjects);
  expect(mockStore.elements.size).toBe(initialElements);

  expectExactlyOnceConnectionAndPreview();
  expect(provider.calls.map(({ operation }) => operation)).toEqual([
    "identity",
    "timeline",
    "image",
    "video",
  ]);
  expect(provider.calls.slice(0, 2).map(({ authorization }) => authorization)).toEqual([
    `Bearer ${X_OAUTH_ACCESS_TOKEN}`,
    `Bearer ${X_OAUTH_ACCESS_TOKEN}`,
  ]);
  expect(provider.calls.slice(2).every(({ authorization }) => authorization === undefined)).toBe(
    true,
  );
  expect([...mockStore.origins.values()]).toEqual([
    expect.objectContaining({
      document: expect.objectContaining({
        mime: X_OAUTH_CAPTURE_MIME,
        label: expect.stringMatching(/^x-oauth-[0-9a-f-]{36}\.zip$/),
      }),
    }),
  ]);
  await expectCleanBrowserBoundary(page);

  await page.getByRole("button", { name: "Confirm import" }).click();
  await expect(page.getByText("Target Vibe: @example_user Tweets", { exact: true })).toBeVisible();
  const created = mockStore.vibes.find(({ uri }) => uri.endsWith(`/${NEW_VIBE_ID}`));
  expect(created?.title).toBe("@example_user Tweets");
  expect(created?.objects).toHaveLength(2);
  expect(mockStore.objects.size).toBe(initialObjects + 2);
  expect(mockStore.elements.size).toBe(initialElements + 4);
  const tweets = [...mockStore.objects.values()].filter(({ type }) => type === "tweet");
  expect(tweets.map(({ keys }) => keys?.x_tweet_id)).toEqual(["205", "204"]);
  expect(tweets[0]?.elements.map(({ role }) => role)).toEqual(["content", "content"]);
  expect(tweets[0]?.elements[1]).not.toHaveProperty("alt");
  expect(mockStore.elements.get(tweets[0]!.elements[1]!.uri.split("/").at(-1) ?? "")?.alt).toBe(
    "A mocked horizon",
  );
  expect(tweets[0]?.source.properties).not.toHaveProperty("text");

  await page.goto(`/vibes/${NEW_VIBE_ID}`);
  await expect(page.locator("[data-media-object-card]")).toHaveCount(2);
  for (const displayName of X_DISPLAY_NAMES) {
    await expect(page.getByText(displayName, { exact: true })).toBeVisible();
  }

  await page.goto("/imports");
  await page.getByRole("button", { name: "Import into a new Vibe" }).click();
  await expect(page.getByRole("button", { name: "Sign in with X", exact: true })).toBeVisible();
  await expect(page.getByLabel("VERIFY reconciliation")).toHaveCount(0);
  expectExactlyOnceConnectionAndPreview();
  expect(provider.calls).toHaveLength(4);
});

test("X provider denial is recoverable and leaves no credential, source, or capture", async ({
  page,
}) => {
  mockStore.rejectNextOAuthConnection();
  await page.goto("/imports");
  await page.getByRole("button", { name: "Import into a new Vibe" }).click();
  await selectAndConnect(page);

  await expect(page.getByRole("alert")).toHaveText(
    "The source connection was not approved. Choose the source to try again.",
  );
  await expect(page).toHaveURL(/\/imports$/);
  await expect(page.getByRole("button", { name: "Sign in with X", exact: true })).toBeVisible();
  expect([...mockStore.sourceConnectionAttempts.values()]).toEqual([
    expect.objectContaining({
      skill_id: xOAuthSourceManifest.skill_id,
      status: "rejected",
      error_code: "provider_denied",
    }),
  ]);
  expect(mockStore.sourceCredentials.size).toBe(0);
  expect(mockStore.ingestionSources.size).toBe(0);
  expect(mockStore.origins.size).toBe(0);
  expect(provider.calls).toEqual([]);
  await expectCleanBrowserBoundary(page);
});

async function selectAndConnect(page: Page): Promise<void> {
  await page
    .getByLabel("Import source", { exact: true })
    .selectOption({ label: xOAuthSourceManifest.label });
  await expect(page.getByText("Up to 25 objects · capture limit 50 MB")).toBeVisible();
  await page
    .getByRole("button", { name: xOAuthSourceManifest.connection.button_label, exact: true })
    .click();
}

function requestsTo(pathname: string, method?: string) {
  return mockStore.requests.filter((request) => {
    const url = new URL(request.url());
    return url.pathname === pathname && (!method || request.method() === method);
  });
}

function expectExactlyOnceConnectionAndPreview(): void {
  const skillId = xOAuthSourceManifest.skill_id;
  expect(requestsTo(`/rnet/v0/source-connections/${skillId}/oauth`, "POST")).toHaveLength(1);
  expect(requestsTo("/rnet/v0/source-connections/oauth/callback", "GET")).toHaveLength(1);
  expect(requestsTo("/rnet/v0/ingestion-sources", "POST")).toHaveLength(1);
  expect(requestsTo("/rnet/v0/imports", "POST")).toHaveLength(1);
  expect(requestsTo("/rnet/v0/ingestion-sources", "POST")[0]?.postDataJSON()).toEqual({
    credential: expect.stringMatching(/^credential:/),
  });
  const authorizationRequests = mockStore.requests.filter((request) =>
    request.url().startsWith(X_OAUTH_AUTHORIZATION_ENDPOINT),
  );
  expect(authorizationRequests).toHaveLength(1);
  const authorization = new URL(authorizationRequests[0]!.url());
  expect(authorizationRequests[0]!.method()).toBe("GET");
  expect(authorization.searchParams.get("response_type")).toBe("code");
  expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authorization.searchParams.get("code_challenge")).toMatch(/^\S{43,128}$/);
  expect(authorization.searchParams.get("state")).toMatch(/^\S{32,}$/);
  expect(authorization.searchParams.get("redirect_uri")).toMatch(
    /\/rnet\/v0\/source-connections\/oauth\/callback$/,
  );
  expect(authorization.href).not.toContain(X_OAUTH_ACCESS_TOKEN);
  expect(
    requestsTo("/rnet/v0/source-connections/oauth/callback", "GET")[0]?.headers()["cookie"],
  ).toMatch(/(?:^|;\s*)rhizome_oauth_[0-9a-f-]{36}=\S{43}(?:;|$)/);
}

async function expectCleanBrowserBoundary(page: Page): Promise<void> {
  const storage = await page.evaluate(() => ({
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
  const persisted = await page.context().storageState();
  const browserText = JSON.stringify({ storage, persisted });
  const requestBodies = mockStore.requests.map((request) => request.postData() ?? "").join("\n");
  for (const secret of [X_OAUTH_AUTHORIZATION_CODE, X_OAUTH_ACCESS_TOKEN]) {
    expect(browserText).not.toContain(secret);
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
