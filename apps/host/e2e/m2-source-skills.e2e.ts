import { expect, test, type Page, type Request } from "@playwright/test";

import { VIBE_ID, installMockStore, type MockStore } from "@rhizome/test-support/mockStore";
import {
  SYNTHETIC_COLLECTION,
  SYNTHETIC_COLLECTION_INPUT_LABEL,
  SYNTHETIC_CREDENTIAL_ID,
  SYNTHETIC_CREDENTIAL_INPUT_LABEL,
  SYNTHETIC_CREDENTIAL_SKILL_LABEL,
  SYNTHETIC_FILE_SKILL_LABEL,
  SYNTHETIC_INVALID_SECRET,
  SYNTHETIC_PUBLIC_INPUT_LABEL,
  SYNTHETIC_PUBLIC_SKILL_LABEL,
  SYNTHETIC_PUBLIC_URL,
  SYNTHETIC_SOURCE_ACTION_DETAIL,
  SYNTHETIC_SOURCE_ACTION_TITLE,
  SYNTHETIC_VALID_SECRET,
  mockSyntheticCredentialedSourceSkill,
  mockSyntheticFileSourceSkill,
  mockSyntheticPublicSourceSkill,
} from "./support/syntheticSourceSkills.ts";

let mockStore: MockStore;

test.beforeEach(async ({ page }) => {
  mockStore = await installMockStore(page, {
    sourceSkills: [
      mockSyntheticFileSourceSkill,
      mockSyntheticPublicSourceSkill,
      mockSyntheticCredentialedSourceSkill,
    ],
  });
  const target = mockStore.vibes[0];
  if (!target) throw new Error("Missing mocked target Vibe");
  delete target.pull;
});

async function openImport(page: Page, sourceLabel: string): Promise<void> {
  await page.goto(`/vibes/${VIBE_ID}`);
  await page.getByRole("button", { name: "Import into this Vibe", exact: true }).click();
  await page.getByLabel("Import source", { exact: true }).selectOption({ label: sourceLabel });
}

async function expectSyntheticReview(page: Page, checkCount = 2): Promise<void> {
  const reconciliation = page.getByLabel("VERIFY reconciliation");
  await expect(reconciliation).toBeVisible();
  await expect(reconciliation).toContainText("2 objects passed VERIFY");
  await expect(reconciliation).toContainText("2 source records → 2 candidates");
  await expect(page.getByRole("list", { name: "VERIFY checks" }).getByRole("listitem")).toHaveCount(
    checkCount,
  );
  await expect(
    page.getByRole("list", { name: "Candidate media objects" }).locator("[data-import-candidate]"),
  ).toHaveCount(2);
}

async function configureSyntheticCredentialedSource(page: Page): Promise<string> {
  await openImport(page, SYNTHETIC_CREDENTIAL_SKILL_LABEL);
  await page.getByLabel(SYNTHETIC_CREDENTIAL_INPUT_LABEL).fill(SYNTHETIC_VALID_SECRET);
  await page
    .getByRole("button", { name: `Review ${SYNTHETIC_CREDENTIAL_SKILL_LABEL}`, exact: true })
    .click();
  await expectSyntheticReview(page);

  const source = [...mockStore.ingestionSources.values()].find(
    (candidate) => candidate.kind === "credential",
  );
  if (!source) throw new Error("Missing synthetic credentialed source");

  await page.getByRole("button", { name: "Confirm import" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Imported" })).toContainText(
    `Imported 2 objects from ${SYNTHETIC_CREDENTIAL_SKILL_LABEL}.`,
  );
  return source.source;
}

function postsTo(pathname: string): Request[] {
  return mockStore.requests.filter(
    (request) => request.method() === "POST" && new URL(request.url()).pathname === pathname,
  );
}

test("the host renders every installed source kind from the generic catalog", async ({ page }) => {
  await page.goto(`/vibes/${VIBE_ID}`);
  await page.getByRole("button", { name: "Import into this Vibe", exact: true }).click();

  const sourceSelect = page.getByLabel("Import source", { exact: true });
  await expect(sourceSelect.locator("option")).toHaveText([
    SYNTHETIC_FILE_SKILL_LABEL,
    SYNTHETIC_PUBLIC_SKILL_LABEL,
    SYNTHETIC_CREDENTIAL_SKILL_LABEL,
  ]);
  await expect(sourceSelect).toHaveCSS("appearance", "none");
  await expect(sourceSelect).toHaveCSS("border-radius", "12px");
  await expect(page.getByText("Up to 10 objects · capture limit 1.0 MB")).toBeVisible();

  const caret = sourceSelect.locator("xpath=..").locator("[data-select-input-caret]");
  const selectBox = await sourceSelect.boundingBox();
  const caretBox = await caret.boundingBox();
  expect(selectBox).not.toBeNull();
  expect(caretBox).not.toBeNull();
  expect(
    Math.abs(selectBox!.y + selectBox!.height / 2 - (caretBox!.y + caretBox!.height / 2)),
  ).toBe(0);
  expect(
    mockStore.requests.filter(
      (request) =>
        request.method() === "GET" && new URL(request.url()).pathname === "/rnet/v0/source-skills",
    ),
  ).toHaveLength(1);
});

test("a synthetic public source normalizes config and commits only after review", async ({
  page,
}) => {
  const initialObjectCount = mockStore.objects.size;
  await openImport(page, SYNTHETIC_PUBLIC_SKILL_LABEL);

  await page.getByLabel(SYNTHETIC_PUBLIC_INPUT_LABEL).fill(SYNTHETIC_PUBLIC_URL);
  await page
    .getByRole("button", { name: `Review ${SYNTHETIC_PUBLIC_SKILL_LABEL}`, exact: true })
    .click();
  await expectSyntheticReview(page);

  const [source] = [...mockStore.ingestionSources.values()];
  expect(source).toMatchObject({
    kind: "remote",
    skill_id: mockSyntheticPublicSourceSkill.manifest.skill_id,
    limits: mockSyntheticPublicSourceSkill.manifest.limits,
    connector_version: mockSyntheticPublicSourceSkill.manifest.connector_version,
    parser: mockSyntheticPublicSourceSkill.manifest.parser.name,
    config: { url: SYNTHETIC_PUBLIC_URL },
  });
  expect(postsTo("/rnet/v0/ingestion-sources")[0]?.postDataJSON()).toEqual({
    skill_id: mockSyntheticPublicSourceSkill.manifest.skill_id,
    config: { url: SYNTHETIC_PUBLIC_URL },
  });
  expect(mockStore.objects.size).toBe(initialObjectCount);

  await page.getByRole("button", { name: "Confirm import" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Imported" })).toContainText(
    `Imported 2 objects from ${SYNTHETIC_PUBLIC_SKILL_LABEL}.`,
  );
  expect(mockStore.objects.size).toBe(initialObjectCount + 2);
  expect(mockStore.vibes[0]?.pull?.sources).toContain(source?.source);
});

test("credentialed-source conformance clears the secret and resumes an opaque action once", async ({
  page,
}) => {
  await openImport(page, SYNTHETIC_CREDENTIAL_SKILL_LABEL);
  const secretField = page.getByLabel(SYNTHETIC_CREDENTIAL_INPUT_LABEL);
  await secretField.fill(SYNTHETIC_VALID_SECRET);
  await page.getByLabel(SYNTHETIC_COLLECTION_INPUT_LABEL).fill(SYNTHETIC_COLLECTION);
  const credentialPath = `/rnet/v0/source-credentials/${mockSyntheticCredentialedSourceSkill.manifest.skill_id}`;
  const releaseSourceCreation = mockStore.holdNextIngestionSourceCreation();
  try {
    await page
      .getByRole("button", { name: `Review ${SYNTHETIC_CREDENTIAL_SKILL_LABEL}`, exact: true })
      .click();
    // Reaching the source-creation request proves the credential exchange settled. Keep that
    // second request pending so the assertion cannot accidentally pass only after the full import.
    await expect.poll(() => postsTo(credentialPath).length).toBe(1);
    await expect.poll(() => postsTo("/rnet/v0/ingestion-sources").length).toBe(1);
    await expect(secretField).toHaveValue("");
  } finally {
    releaseSourceCreation();
  }

  await expectSyntheticReview(page);
  const credentialRequests = postsTo(credentialPath);
  expect(credentialRequests).toHaveLength(1);
  expect(credentialRequests[0]?.postDataJSON()).toEqual({ access_token: SYNTHETIC_VALID_SECRET });
  expect(
    mockStore.requests.filter((request) =>
      (request.postData() ?? "").includes(SYNTHETIC_VALID_SECRET),
    ),
  ).toEqual(credentialRequests);

  const sourceRequest = postsTo("/rnet/v0/ingestion-sources")[0];
  expect(sourceRequest?.postDataJSON()).toEqual({
    credential: `credential:${SYNTHETIC_CREDENTIAL_ID}`,
    config: { collection: SYNTHETIC_COLLECTION },
  });
  expect(sourceRequest?.postData()).not.toContain(SYNTHETIC_VALID_SECRET);
  const source = [...mockStore.ingestionSources.values()].find(
    (candidate) => candidate.kind === "credential",
  );
  if (!source) throw new Error("Missing synthetic credentialed source");

  await page.getByRole("button", { name: "Confirm import" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Imported" })).toContainText(
    `Imported 2 objects from ${SYNTHETIC_CREDENTIAL_SKILL_LABEL}.`,
  );
  await expect(page.getByRole("button", { name: "Refresh sources" })).toBeVisible();
  expect(mockStore.vibes[0]?.pull?.sources).toContain(source.source);

  mockStore.requireNextSourceAction({
    skillId: mockSyntheticCredentialedSourceSkill.manifest.skill_id,
    source: source.source,
    timing: "pull_problem",
  });
  await page.getByRole("button", { name: "Refresh sources" }).click();

  await expect(page.getByText(SYNTHETIC_SOURCE_ACTION_TITLE, { exact: true })).toBeVisible();
  await expect(page.getByText(SYNTHETIC_SOURCE_ACTION_DETAIL, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review import" }).click();
  await expectSyntheticReview(page, 3);
  await expect(page.locator('[data-verify-check="owner_review"]')).toContainText(
    "The owner resumed this reviewed source action",
  );

  const previewRequests = postsTo(`/rnet/v0/vibes/${VIBE_ID}/imports`);
  const continuationRequest = previewRequests.at(-1);
  const continuationBody = continuationRequest?.postDataJSON() as
    { source?: string; continuation_token?: string } | undefined;
  expect(continuationBody).toEqual({
    source: source.source,
    continuation_token: expect.stringMatching(/^mock-continuation-\S{32,}$/),
  });
  const continuationToken = continuationBody?.continuation_token;
  if (!continuationToken) throw new Error("Missing mock continuation token");
  expect(
    mockStore.requests.filter((request) => (request.postData() ?? "").includes(continuationToken)),
  ).toEqual([continuationRequest]);
  expect(postsTo(credentialPath)).toHaveLength(1);
  expect(
    mockStore.requests.filter((request) =>
      (request.postData() ?? "").includes(SYNTHETIC_VALID_SECRET),
    ),
  ).toEqual(credentialRequests);
});

test("generic source actions stay hidden outside the configured owner and source context", async ({
  page,
}) => {
  await configureSyntheticCredentialedSource(page);
  const importPath = `/rnet/v0/vibes/${VIBE_ID}/imports`;
  const initialPreviewRequests = postsTo(importPath).length;
  const unconfiguredSource = `source:${VIBE_ID}`;

  for (const timing of ["pull_problem", "polled_operation"] as const) {
    mockStore.requireNextSourceAction({
      skillId: mockSyntheticCredentialedSourceSkill.manifest.skill_id,
      source: null,
      timing,
    });
    await page.getByRole("button", { name: "Refresh sources" }).click();
    await expect(
      page.getByText("The connected source owner must review an import before pulling again."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Review import" })).toHaveCount(0);
    await expect(page.getByText(SYNTHETIC_SOURCE_ACTION_TITLE, { exact: true })).toHaveCount(0);
    expect(postsTo(importPath)).toHaveLength(initialPreviewRequests);

    mockStore.requireNextSourceAction({
      skillId: mockSyntheticCredentialedSourceSkill.manifest.skill_id,
      source: unconfiguredSource,
      timing,
    });
    await page.getByRole("button", { name: "Refresh sources" }).click();
    const expectedFailure =
      timing === "pull_problem"
        ? SYNTHETIC_SOURCE_ACTION_DETAIL
        : mockSyntheticCredentialedSourceSkill.sourceAction.operationError;
    await expect(page.getByText(expectedFailure, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Review import" })).toHaveCount(0);
    await expect(page.getByText(SYNTHETIC_SOURCE_ACTION_TITLE, { exact: true })).toHaveCount(0);
    expect(postsTo(importPath)).toHaveLength(initialPreviewRequests);
  }

  expect(
    mockStore.requests.filter((request) =>
      (request.postData() ?? "").includes("mock-continuation-"),
    ),
  ).toHaveLength(0);
});

test("a rejected synthetic credential is cleared after its single connection request", async ({
  page,
}) => {
  await openImport(page, SYNTHETIC_CREDENTIAL_SKILL_LABEL);
  const secretField = page.getByLabel(SYNTHETIC_CREDENTIAL_INPUT_LABEL);
  await secretField.fill(SYNTHETIC_INVALID_SECRET);
  await page
    .getByRole("button", { name: `Review ${SYNTHETIC_CREDENTIAL_SKILL_LABEL}`, exact: true })
    .click();

  await expect(secretField).toHaveValue("");
  await expect(page.getByRole("alert")).toHaveText(
    "The synthetic source rejected this access token",
  );
  const credentialPath = `/rnet/v0/source-credentials/${mockSyntheticCredentialedSourceSkill.manifest.skill_id}`;
  const credentialRequests = postsTo(credentialPath);
  expect(credentialRequests).toHaveLength(1);
  expect(
    mockStore.requests.filter((request) =>
      (request.postData() ?? "").includes(SYNTHETIC_INVALID_SECRET),
    ),
  ).toEqual(credentialRequests);
  expect(mockStore.sourceCredentials.size).toBe(0);
  expect(mockStore.ingestionSources.size).toBe(0);
  expect(mockStore.origins.size).toBe(0);
});
