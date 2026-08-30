import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { MediaObject } from "@rnet/types";
import {
  type IngestionSourceDocument,
  type OperationDocument,
  type SourceCredentialDocument,
} from "@rhizome/store-contract";
import { and, asc, eq, sql } from "drizzle-orm";
import S3rver from "s3rver";
import { v7 as uuidv7 } from "uuid";

import { CredentialedSourceCatalog } from "../../ingest/connected-sources/types.ts";
import {
  SIMPLEFIN_CONNECTOR_VERSION,
  SIMPLEFIN_PARSER_NAME,
  SIMPLEFIN_SKILL_ID,
} from "../../ingest/skills/simplefin/contracts.ts";
import { createSimpleFinSkill } from "../../ingest/skills/simplefin/source.ts";
import { createApp } from "../src/app.ts";
import { DEV_OTHER_USER_UUID, DEV_USER_UUID } from "../src/auth.ts";
import { createBlobStore } from "../src/blobs/index.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase } from "../src/db/index.ts";
import { ingestionSourceFetches } from "../src/db/models/ingestion-source-fetch.ts";
import { ingestionSources } from "../src/db/models/ingestion-source.ts";
import { mediaObjectRevisions } from "../src/db/models/media-object-revision.ts";
import { operations } from "../src/db/models/operation.ts";
import { originArtifacts } from "../src/db/models/origin-artifact.ts";
import { sourceCredentials } from "../src/db/models/source-credential.ts";
import { seedDb } from "../src/db/seedDb.ts";
import {
  createCredentialKeyring,
  credentialAssociatedData,
  openCredentialSecret,
  sealCredentialSecret,
} from "../src/services/source-credential-crypto.ts";

const databaseUrl = process.env.RHIZOME_TEST_DATABASE_URL ?? "postgres://localhost/rhizome_m1_test";
const { db, client } = createDatabase(databaseUrl, { max: 4 });
let scratch = "";
let s3: S3rver | undefined;
let app: ReturnType<typeof createApp>["app"];

const buckets = {
  elements: "elements",
  origins: "origins",
  bundles: "bundles",
  assets: "assets",
} as const;

const owner = { Authorization: "Bearer dev:user" };
const otherOwner = { Authorization: "Bearer dev:user:other" };
const dmachine = { Authorization: "Bearer dev:client:rbudget" };
const credentialEncryptionKey = Uint8Array.from({ length: 32 }, (_, index) => index);
const credentialEncryptionKeys = createCredentialKeyring("test", {
  test: credentialEncryptionKey,
});
const simpleFinAccessUrl = "https://alice:very-secret@bridge.simplefin.test/simplefin";
const simpleFinClaimUrl = "https://bridge.simplefin.test/claim/once";
const simpleFinSetupToken = Buffer.from(simpleFinClaimUrl).toString("base64");
const connectedPullSetupToken = Buffer.from(
  "https://bridge.simplefin.test/claim/connected-pull",
).toString("base64");
const compromisedSetupToken = Buffer.from(
  "https://bridge.simplefin.test/claim/compromised",
).toString("base64");
const simpleFinRequests: Request[] = [];
const simpleFinAccountResponses: Uint8Array[] = [];
const simpleFinAccountFetches: Array<() => Promise<Uint8Array>> = [];

beforeAll(async () => {
  await client.unsafe(`
    TRUNCATE TABLE
      meter_entry, media_object_revisions, vibe_revisions, media_object_origins, media_object_elements,
      vibe_media_objects, grants, operations, ingestion_source_objects, ingestion_sources,
      source_credential_claim_attempts, source_credentials, media_objects,
      media_elements, origins, vibes, dmachines, users
    CASCADE
  `);
  scratch = await mkdtemp(join(tmpdir(), "rhizome-s3-"));
  s3 = new S3rver({
    address: "127.0.0.1",
    port: 0,
    silent: true,
    directory: join(scratch, "storage"),
    configureBuckets: Object.values(buckets).map((name) => ({ name, configs: [] })),
  });
  const address = await s3.run();
  const config: ServerConfig = {
    port: 3000,
    databaseUrl,
    authMode: "dev",
    baseUrl: "http://rhizome.test",
    allowedOrigins: ["http://rhizome.test"],
    maxRequestBodySize: 52_428_800,
    sourceCredentials: {
      keyProvider: {
        driver: "local",
        keyring: credentialEncryptionKeys,
      },
      sources: { simplefin: { allowedHosts: ["bridge.simplefin.test"] } },
    },
    blob: {
      driver: "r2",
      endpoint: `http://${address.address}:${address.port}`,
      accessKeyId: "S3RVER",
      secretAccessKey: "S3RVER",
      forcePathStyle: true,
      buckets,
    },
  };
  const created = createApp({
    config,
    db,
    blobs: createBlobStore(config),
    credentialedSources: new CredentialedSourceCatalog([
      createSimpleFinSkill({
        allowedHosts: ["bridge.simplefin.test"],
        fetch: async (input, init) => {
          const request = new Request(input, init);
          simpleFinRequests.push(request);
          if (request.url.endsWith("/claim/compromised")) {
            return new Response(null, { status: 403 });
          }
          if (request.method === "GET") {
            const fetch = simpleFinAccountFetches.shift();
            const bytes = fetch ? await fetch() : simpleFinAccountResponses.shift();
            return bytes
              ? new Response(bytes.slice().buffer as ArrayBuffer, {
                  headers: { "Content-Type": "application/json" },
                })
              : new Response(null, { status: 503 });
          }
          return new Response(`${simpleFinAccessUrl}\n`);
        },
      }),
    ]),
  });
  app = created.app;
  await seedDb(db);
});

afterAll(async () => {
  await s3?.close();
  await client.end();
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

describe("rNet M1 store", () => {
  let vibeId = "";
  let mediaObjectId = "";
  let repeatableMediaObjectUri = "";
  let originUri = "";
  let originHash = "";

  test("rejects anonymous Vibe creation", async () => {
    const response = await request("/rnet/v0/vibes", { method: "POST", json: { title: "Nope" } });
    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toContain("application/problem+json");
  });

  test("validates JSON request schemas at the route boundary", async () => {
    const extraProperty = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: { title: "Nope", source: {} },
    });
    expect(extraProperty.status).toBe(422);

    const malformed = await app.request("http://rhizome.test/rnet/v0/vibes", {
      method: "POST",
      headers: { ...owner, "Content-Type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(422);
    expect(malformed.headers.get("Content-Type")).toContain("application/problem+json");

    const invalidPath = await request("/rnet/v0/elements/not-a-uuid", { headers: owner });
    expect(invalidPath.status).toBe(422);
    expect(invalidPath.headers.get("Content-Type")).toContain("application/problem+json");

    const invalidUploadKind = await app.request("http://rhizome.test/rnet/v0/elements", {
      method: "POST",
      headers: { ...owner, "Content-Type": "text/plain", "X-Rnet-Kind": "executable" },
      body: "echo nope",
    });
    expect(invalidUploadKind.status).toBe(422);

    const missingUploadKind = await app.request("http://rhizome.test/rnet/v0/elements", {
      method: "POST",
      headers: { ...owner, "Content-Type": "text/plain" },
      body: "missing kind",
    });
    expect(missingUploadKind.status).toBe(422);
  });

  test("connects, owns, encrypts, uses, and revokes a SimpleFIN credential without leaking it", async () => {
    const initialClaims = simpleFinRequests.length;
    const clientAttempt = await request("/rnet/v0/source-credentials/simplefin", {
      method: "POST",
      headers: dmachine,
      json: { setup_token: simpleFinSetupToken },
    });
    expect(clientAttempt.status).toBe(403);
    expect(simpleFinRequests).toHaveLength(initialClaims);

    const connectResponse = await request("/rnet/v0/source-credentials/simplefin", {
      method: "POST",
      headers: owner,
      json: { setup_token: simpleFinSetupToken },
    });
    expect(connectResponse.status).toBe(201);
    const credential = (await connectResponse.json()) as SourceCredentialDocument;
    expect(credential.skill_id).toBe(SIMPLEFIN_SKILL_ID);
    expect(credential.connector_version).toBe(SIMPLEFIN_CONNECTOR_VERSION);
    expect(credential.status).toBe("active");
    const credentialResponseText = JSON.stringify(credential);
    expect(credentialResponseText).not.toContain(simpleFinAccessUrl);
    expect(credentialResponseText).not.toContain("very-secret");
    expect(credentialResponseText).not.toContain(simpleFinSetupToken);

    const claimsAfterConnect = simpleFinRequests.length;
    const replayResponse = await request("/rnet/v0/source-credentials/simplefin", {
      method: "POST",
      headers: owner,
      json: { setup_token: simpleFinSetupToken },
    });
    expect(replayResponse.status).toBe(201);
    expect((await replayResponse.json()).credential).toBe(credential.credential);
    expect(simpleFinRequests).toHaveLength(claimsAfterConnect);
    const otherOwnerReplay = await request("/rnet/v0/source-credentials/simplefin", {
      method: "POST",
      headers: otherOwner,
      json: { setup_token: simpleFinSetupToken },
    });
    expect(otherOwnerReplay.status).toBe(422);
    expect(simpleFinRequests).toHaveLength(claimsAfterConnect);

    const credentialUuid = credential.credential.slice("credential:".length);
    const storedCredential = await db.query.sourceCredentials.findFirst({
      where: eq(sourceCredentials.uuid, credentialUuid),
    });
    expect(storedCredential).toBeDefined();
    expect(storedCredential?.metadata).toBeNull();
    expect(new TextDecoder().decode(storedCredential?.secret)).not.toContain("very-secret");
    expect(
      await openCredentialSecret(
        storedCredential!.secret,
        credentialEncryptionKeys,
        credentialAssociatedData(credentialUuid, DEV_USER_UUID, SIMPLEFIN_SKILL_ID),
      ),
    ).toBe(simpleFinAccessUrl);

    const otherOwnerRead = await request(`/rnet/v0/source-credentials/${credentialUuid}`, {
      headers: otherOwner,
    });
    expect(otherOwnerRead.status).toBe(404);

    const otherOwnerSource = await request("/rnet/v0/ingestion-sources", {
      method: "POST",
      headers: otherOwner,
      json: { credential: credential.credential },
    });
    expect(otherOwnerSource.status).toBe(404);

    const sourceResponse = await request("/rnet/v0/ingestion-sources", {
      method: "POST",
      headers: owner,
      json: {
        credential: credential.credential,
        config: {
          accounts: [{ connection_id: "bank", account_id: "checking" }],
          include_pending: true,
        },
      },
    });
    expect(sourceResponse.status).toBe(201);
    const source = (await sourceResponse.json()) as IngestionSourceDocument;
    expect(source.kind).toBe("credential");
    expect(source.parser).toBe(SIMPLEFIN_PARSER_NAME);
    expect(source.parser_version).toBe("simplefin@2.0.0");
    if (source.kind === "credential") {
      expect(source.config).toEqual({
        accounts: [{ connection_id: "bank", account_id: "checking" }],
        include_pending: true,
      });
    }
    expect(JSON.stringify(source)).not.toContain(credentialUuid);
    expect(JSON.stringify(source)).not.toContain("very-secret");

    const unsupportedCredentialUuid = uuidv7();
    await db.insert(sourceCredentials).values({
      uuid: unsupportedCredentialUuid,
      userUuid: DEV_USER_UUID,
      skillId: "unsupported-provider",
      connectorVersion: "unsupported-provider-connector@1.0.0",
      secret: Uint8Array.of(1),
    });
    const unsupportedSource = await request("/rnet/v0/ingestion-sources", {
      method: "POST",
      headers: owner,
      json: { credential: `credential:${unsupportedCredentialUuid}` },
    });
    expect(unsupportedSource.status).toBe(422);
    expect((await unsupportedSource.json()).code).toBe("parser_unsupported");

    const revokeResponse = await request(`/rnet/v0/source-credentials/${credentialUuid}`, {
      method: "DELETE",
      headers: owner,
    });
    expect(revokeResponse.status).toBe(204);
    const sourceUuid = source.source.slice("source:".length);
    const storedSource = await db.query.ingestionSources.findFirst({
      where: eq(ingestionSources.uuid, sourceUuid),
    });
    expect(storedSource?.revokedAt).toBeInstanceOf(Date);

    const revokedCredentialResponse = await request(
      `/rnet/v0/source-credentials/${credentialUuid}`,
      { headers: owner },
    );
    expect(revokedCredentialResponse.status).toBe(200);
    expect(((await revokedCredentialResponse.json()) as SourceCredentialDocument).status).toBe(
      "revoked",
    );
    const revokedReplay = await request("/rnet/v0/source-credentials/simplefin", {
      method: "POST",
      headers: owner,
      json: { setup_token: simpleFinSetupToken },
    });
    expect(revokedReplay.status).toBe(422);
    expect(simpleFinRequests).toHaveLength(claimsAfterConnect);
    const revokedSource = await request("/rnet/v0/ingestion-sources", {
      method: "POST",
      headers: owner,
      json: { credential: credential.credential },
    });
    expect(revokedSource.status).toBe(404);

    const [credentialCountBefore] = await client.unsafe(
      "select count(*)::int as count from source_credentials",
    );
    const compromisedResponse = await request("/rnet/v0/source-credentials/simplefin", {
      method: "POST",
      headers: owner,
      json: { setup_token: compromisedSetupToken },
    });
    expect(compromisedResponse.status).toBe(422);
    const compromisedProblem = await compromisedResponse.json();
    expect(compromisedProblem.code).toBe("source_connection_failed");
    expect(compromisedProblem.detail.toLowerCase()).toContain("compromised");
    expect(compromisedProblem.detail.toLowerCase()).toContain("disable");
    expect(JSON.stringify(compromisedProblem)).not.toContain(compromisedSetupToken);
    const requestsAfterCompromisedClaim = simpleFinRequests.length;
    const compromisedReplay = await request("/rnet/v0/source-credentials/simplefin", {
      method: "POST",
      headers: owner,
      json: { setup_token: compromisedSetupToken },
    });
    expect(compromisedReplay.status).toBe(422);
    expect(simpleFinRequests).toHaveLength(requestsAfterCompromisedClaim);
    const [credentialCountAfter] = await client.unsafe(
      "select count(*)::int as count from source_credentials",
    );
    expect(credentialCountAfter?.count).toBe(credentialCountBefore?.count);
  });

  test("stages immutable SimpleFIN captures and advances the verified baseline only on commit", async () => {
    const connectResponse = await request("/rnet/v0/source-credentials/simplefin", {
      method: "POST",
      headers: owner,
      json: { setup_token: connectedPullSetupToken },
    });
    expect(connectResponse.status).toBe(201);
    const credential = (await connectResponse.json()) as SourceCredentialDocument;
    const credentialUuid = credential.credential.slice("credential:".length);
    const sourceConfig = {
      accounts: [
        { connection_id: "conn-alpha", account_id: "acct-shared" },
        { connection_id: "conn-beta", account_id: "acct-shared" },
      ],
      include_pending: true,
    };
    const sourceResponse = await request("/rnet/v0/ingestion-sources", {
      method: "POST",
      headers: owner,
      json: { credential: credential.credential, config: sourceConfig },
    });
    expect(sourceResponse.status).toBe(201);
    const source = (await sourceResponse.json()) as IngestionSourceDocument;
    const sourceUuid = source.source.slice("source:".length);
    expect(JSON.stringify(source)).not.toContain(credentialUuid);

    const vibeResponse = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: {
        title: "Connected SimpleFIN",
        grants: [
          { subject: "client:rbudget", scope: ["pull"] },
          {
            subject: `id:rnet://id/${DEV_OTHER_USER_UUID}`,
            scope: ["pull"],
          },
        ],
      },
    });
    expect(vibeResponse.status).toBe(201);
    const vibe = await vibeResponse.json();
    const connectedVibeId = vibe.uri.split("/").at(-1);
    const objectsBeforePreview = await mediaObjectCount();

    const previousBytes = await simpleFinFixtureBytes("accounts-previous-v2.json");
    simpleFinAccountResponses.push(previousBytes);
    const previewResponse = await request(`/rnet/v0/vibes/${connectedVibeId}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: source.source },
    });
    expect(previewResponse.status).toBe(202);
    const preview = await waitForOperation(await previewResponse.json(), owner);
    expect(preview.status).toBe("done");
    const previewResult = preview.result as {
      candidates: MediaObject[];
      staged_origin: string;
      verify: { ok: boolean; candidate_count: number };
    };
    expect(previewResult.verify).toMatchObject({ ok: true, candidate_count: 0 });
    expect(previewResult.candidates).toEqual([]);
    expect(previewResult.staged_origin).toMatch(/^rnet:\/\/origin\/[0-9a-f-]{36}$/);
    expect(await mediaObjectCount()).toBe(objectsBeforePreview);
    expect(await sourceBindingCount(source.source)).toBe(0);
    const unconfirmedVibe = await request(`/rnet/v0/vibes/${connectedVibeId}`, {
      headers: owner,
    });
    expect((await unconfirmedVibe.json()).pull?.sources ?? []).toEqual([]);

    const [previewFetch] = await db
      .select()
      .from(ingestionSourceFetches)
      .where(eq(ingestionSourceFetches.operationUuid, preview.operation_id));
    expect(previewFetch).toMatchObject({
      sourceUuid,
      ownerUuid: DEV_USER_UUID,
      credentialUuid,
      parserVersion: "simplefin@2.0.0",
      status: "verified",
    });
    expect(previewFetch?.originUuid).toBe(
      previewResult.staged_origin.slice("rnet://origin/".length),
    );
    const stagedBytesResponse = await request(
      `/rnet/v0/origins/${previewFetch?.originUuid}/bytes`,
      { headers: owner },
    );
    expect(stagedBytesResponse.status).toBe(200);
    expect(Array.from(new Uint8Array(await stagedBytesResponse.arrayBuffer()))).toEqual(
      Array.from(previousBytes),
    );

    const accountRequest = [...simpleFinRequests]
      .reverse()
      .find((request) => request.method === "GET");
    expect(accountRequest).toBeDefined();
    const accountRequestUrl = new URL(accountRequest!.url);
    expect(accountRequestUrl.searchParams.getAll("account")).toEqual(["acct-shared"]);
    expect(accountRequestUrl.searchParams.get("pending")).toBe("1");
    const startDateEpoch = Number(accountRequestUrl.searchParams.get("start-date"));
    const endDateEpoch = Number(accountRequestUrl.searchParams.get("end-date"));
    expect(Number.isSafeInteger(startDateEpoch)).toBe(true);
    expect(Number.isSafeInteger(endDateEpoch)).toBe(true);
    expect(endDateEpoch - startDateEpoch).toBe(45 * 24 * 60 * 60);

    const confirmResponse = await request(
      `/rnet/v0/vibes/${connectedVibeId}/imports/${preview.operation_id}/confirm`,
      { method: "POST", headers: owner },
    );
    expect(confirmResponse.status).toBe(200);
    expect((await confirmResponse.json()).pull.sources).toContain(source.source);
    const committedPreviewFetch = await db.query.ingestionSourceFetches.findFirst({
      where: eq(ingestionSourceFetches.uuid, previewFetch!.uuid),
    });
    expect(committedPreviewFetch?.status).toBe("committed");
    expect(committedPreviewFetch?.committedAt).toBeInstanceOf(Date);
    expect(await mediaObjectCount()).toBe(objectsBeforePreview);

    const currentBytes = await simpleFinFixtureBytes("accounts-current-v2.json");
    simpleFinAccountResponses.push(currentBytes);
    const pullResponse = await request(`/rnet/v0/vibes/${connectedVibeId}/pull`, {
      method: "POST",
      headers: owner,
      json: {},
    });
    const pull = await waitForOperation(await pullResponse.json(), owner);
    expect(pull.status).toBe("done");
    expect(pull.result).toMatchObject({
      candidate_count: 4,
      created_count: 4,
      added_count: 4,
      duplicate_count: 0,
      source_results: [
        {
          source: source.source,
          verify: {
            ok: true,
            balance_delta_reconciliations: expect.any(Array),
          },
        },
      ],
    });
    const pullCandidates = (pull.result as { candidates: MediaObject[] }).candidates;
    expect(pullCandidates).toHaveLength(4);
    expect(pullCandidates[0]?.keys).toMatchObject({
      simplefin_connection_id: "conn-alpha",
      simplefin_account_id: "acct-shared",
      simplefin_transaction_id: "shared-transaction",
      fitid: "shared-transaction",
      account_hash: expect.stringMatching(/^sha256:/),
    });
    const firstPullOrigin = pullCandidates[0]?.source.origins[0];
    expect(firstPullOrigin).not.toBe(previewResult.staged_origin);
    expect(
      pullCandidates.every((candidate) => candidate.source.origins[0] === firstPullOrigin),
    ).toBe(true);
    const delegatedViewOfOwnerPull = await request(`/rnet/v0/operations/${pull.operation_id}`, {
      headers: dmachine,
    });
    expect(delegatedViewOfOwnerPull.status).toBe(200);
    const delegatedOwnerPull = await delegatedViewOfOwnerPull.json();
    expect((delegatedOwnerPull.result as { candidates: unknown[] }).candidates).toEqual([]);
    expect((delegatedOwnerPull.result as { source_results: unknown[] }).source_results).toEqual([]);
    expect(JSON.stringify(delegatedOwnerPull)).not.toContain("rnet://origin/");
    expect(JSON.stringify(delegatedOwnerPull)).not.toContain("totals_by_currency");
    const otherUserViewOfOwnerPull = await request(`/rnet/v0/operations/${pull.operation_id}`, {
      headers: otherOwner,
    });
    expect(otherUserViewOfOwnerPull.status).toBe(200);
    const otherUserOwnerPull = await otherUserViewOfOwnerPull.json();
    expect((otherUserOwnerPull.result as { candidates: unknown[] }).candidates).toEqual([]);
    expect((otherUserOwnerPull.result as { source_results: unknown[] }).source_results).toEqual([]);
    expect(JSON.stringify(otherUserOwnerPull)).not.toContain("totals_by_currency");
    expect(JSON.stringify(otherUserOwnerPull)).not.toContain("rnet://origin/");
    expect(await sourceBindingCount(source.source)).toBe(4);
    expect(await mediaObjectCount()).toBe(objectsBeforePreview + 4);

    const serializedPull = JSON.stringify(pull);
    for (const secret of [
      credentialUuid,
      simpleFinAccessUrl,
      "very-secret",
      connectedPullSetupToken,
    ]) {
      expect(serializedPull).not.toContain(secret);
    }

    const objectCountBeforeRepeat = await mediaObjectCount();
    simpleFinAccountResponses.push(currentBytes);
    const repeatResponse = await request(`/rnet/v0/vibes/${connectedVibeId}/pull`, {
      method: "POST",
      headers: owner,
      json: {},
    });
    const repeat = await waitForOperation(await repeatResponse.json(), owner);
    expect(repeat.status).toBe("done");
    expect(repeat.result).toMatchObject({
      candidate_count: 4,
      duplicate_count: 4,
      created_count: 0,
      added_count: 0,
    });
    expect(await mediaObjectCount()).toBe(objectCountBeforeRepeat);
    const committedAfterRepeat = await connectedFetches(sourceUuid, "committed");
    expect(committedAfterRepeat).toHaveLength(3);
    expect(new Set(committedAfterRepeat.map(({ originUuid }) => originUuid)).size).toBe(3);

    simpleFinAccountResponses.push(currentBytes);
    const delegatedResponse = await request(`/rnet/v0/vibes/${connectedVibeId}/pull`, {
      method: "POST",
      headers: dmachine,
      json: {},
    });
    const delegated = await waitForOperation(await delegatedResponse.json(), dmachine);
    expect(delegated.status).toBe("done");
    expect((delegated.result as { candidates: unknown[] }).candidates).toEqual([]);
    expect(JSON.stringify(delegated)).not.toContain("rnet://origin/");
    expect(JSON.stringify(delegated)).not.toContain("very-secret");
    expect(await connectedFetches(sourceUuid, "committed")).toHaveLength(4);

    simpleFinAccountResponses.push(currentBytes);
    const otherUserResponse = await request(`/rnet/v0/vibes/${connectedVibeId}/pull`, {
      method: "POST",
      headers: otherOwner,
      json: {},
    });
    const otherUserPull = await waitForOperation(await otherUserResponse.json(), otherOwner);
    expect(otherUserPull.status).toBe("done");
    expect((otherUserPull.result as { candidates: unknown[] }).candidates).toEqual([]);
    expect(JSON.stringify(otherUserPull)).not.toContain("rnet://origin/");
    expect(await connectedFetches(sourceUuid, "committed")).toHaveLength(5);

    const objectsBeforeProviderError = await mediaObjectCount();
    simpleFinAccountResponses.push(await simpleFinFixtureBytes("provider-errors-v2.json"));
    const failedPullResponse = await request(`/rnet/v0/vibes/${connectedVibeId}/pull`, {
      method: "POST",
      headers: owner,
      json: {},
    });
    const failedPull = await waitForOperation(await failedPullResponse.json(), owner);
    expect(failedPull.status).toBe("failed");
    expect(failedPull.result).toBeNull();
    expect(failedPull.error).toContain("VERIFY rejected");
    expect(failedPull.error).toContain("provider_errors");
    expect(JSON.stringify(failedPull)).not.toContain("very-secret");
    expect(await mediaObjectCount()).toBe(objectsBeforeProviderError);
    const rejectedFetches = await connectedFetches(sourceUuid, "rejected");
    expect(rejectedFetches.at(-1)).toMatchObject({
      errorCode: "verify_failed",
      originUuid: expect.any(String),
    });
    expect(await connectedFetches(sourceUuid, "committed")).toHaveLength(5);

    simpleFinAccountResponses.push(currentBytes);
    const configRaceResponse = await request(`/rnet/v0/vibes/${connectedVibeId}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: source.source },
    });
    const configRace = await waitForOperation(await configRaceResponse.json(), owner);
    expect(configRace.status).toBe("done");
    await db
      .update(ingestionSources)
      .set({ config: { ...sourceConfig, include_pending: false } })
      .where(eq(ingestionSources.uuid, sourceUuid));
    const staleConfigConfirm = await request(
      `/rnet/v0/vibes/${connectedVibeId}/imports/${configRace.operation_id}/confirm`,
      { method: "POST", headers: owner },
    );
    expect(staleConfigConfirm.status).toBe(422);
    expect(await mediaObjectCount()).toBe(objectsBeforeProviderError);
    await db
      .update(ingestionSources)
      .set({ config: sourceConfig })
      .where(eq(ingestionSources.uuid, sourceUuid));

    simpleFinAccountResponses.push(currentBytes);
    const tombstoneResponse = await request(`/rnet/v0/vibes/${connectedVibeId}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: source.source },
    });
    const tombstonePreview = await waitForOperation(await tombstoneResponse.json(), owner);
    const tombstonedOriginUuid = (
      tombstonePreview.result as { staged_origin: string }
    ).staged_origin.slice("rnet://origin/".length);
    await db
      .update(originArtifacts)
      .set({ tombstonedAt: new Date() })
      .where(eq(originArtifacts.uuid, tombstonedOriginUuid));
    const tombstonedConfirm = await request(
      `/rnet/v0/vibes/${connectedVibeId}/imports/${tombstonePreview.operation_id}/confirm`,
      { method: "POST", headers: owner },
    );
    expect(tombstonedConfirm.status).toBe(422);
    expect(await mediaObjectCount()).toBe(objectsBeforeProviderError);

    // Concurrent previews may repeat the same conforming provider snapshot. Both can stage from
    // one committed baseline, but confirming either one makes the other's review stale.
    simpleFinAccountResponses.push(currentBytes);
    const firstConcurrentResponse = await request(`/rnet/v0/vibes/${connectedVibeId}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: source.source },
    });
    const firstConcurrent = await waitForOperation(await firstConcurrentResponse.json(), owner);
    expect(firstConcurrent.status).toBe("done");
    expect((firstConcurrent.result as { candidates: unknown[] }).candidates).toHaveLength(4);
    simpleFinAccountResponses.push(currentBytes);
    const secondConcurrentResponse = await request(`/rnet/v0/vibes/${connectedVibeId}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: source.source },
    });
    const secondConcurrent = await waitForOperation(await secondConcurrentResponse.json(), owner);
    expect(secondConcurrent.status).toBe("done");
    expect((secondConcurrent.result as { candidates: unknown[] }).candidates).toHaveLength(4);
    expect(
      (
        await request(
          `/rnet/v0/vibes/${connectedVibeId}/imports/${firstConcurrent.operation_id}/confirm`,
          { method: "POST", headers: owner },
        )
      ).status,
    ).toBe(200);
    const staleConcurrentConfirm = await request(
      `/rnet/v0/vibes/${connectedVibeId}/imports/${secondConcurrent.operation_id}/confirm`,
      { method: "POST", headers: owner },
    );
    expect(staleConcurrentConfirm.status).toBe(422);
    expect(await mediaObjectCount()).toBe(objectsBeforeProviderError);

    simpleFinAccountResponses.push(currentBytes);
    const revokeRaceResponse = await request(`/rnet/v0/vibes/${connectedVibeId}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: source.source },
    });
    const revokeRace = await waitForOperation(await revokeRaceResponse.json(), owner);
    expect(revokeRace.status).toBe("done");
    expect(
      (
        await request(`/rnet/v0/source-credentials/${credentialUuid}`, {
          method: "DELETE",
          headers: owner,
        })
      ).status,
    ).toBe(204);
    const revokedConfirm = await request(
      `/rnet/v0/vibes/${connectedVibeId}/imports/${revokeRace.operation_id}/confirm`,
      { method: "POST", headers: owner },
    );
    expect(revokedConfirm.status).toBe(404);
    expect(await mediaObjectCount()).toBe(objectsBeforeProviderError);
  });

  test("uses opaque reviewed-action continuations for SimpleFIN history recovery", async () => {
    const fixture = await createStoredSimpleFinCredential(1);
    const source = fixture.sources[0]!;
    const vibeResponse = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: {
        title: "Reviewed SimpleFIN recovery",
        grants: [{ subject: "client:rbudget", scope: ["pull"] }],
      },
    });
    expect(vibeResponse.status).toBe(201);
    const vibeUuid = ((await vibeResponse.json()) as { uri: string }).uri.split("/").at(-1)!;
    const day = 24 * 60 * 60;
    const nowEpoch = Math.floor(Date.now() / 1_000);
    const previousBalanceAt = nowEpoch - 100 * day;
    const previousBytes = simpleFinAccountSetBytes({
      balance: "100.00",
      balanceAtEpoch: previousBalanceAt,
    });
    simpleFinAccountResponses.push(previousBytes);

    const baselineResponse = await request(`/rnet/v0/vibes/${vibeUuid}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: source.source },
    });
    expect(baselineResponse.status).toBe(202);
    const baseline = await waitForOperation(await baselineResponse.json(), owner);
    expect(baseline.status).toBe("done");
    expect(
      (
        await request(`/rnet/v0/vibes/${vibeUuid}/imports/${baseline.operation_id}/confirm`, {
          method: "POST",
          headers: owner,
        })
      ).status,
    ).toBe(200);

    const providerRequestsBeforeGap = simpleFinRequests.filter(
      (providerRequest) => providerRequest.method === "GET",
    ).length;
    const gapResponse = await request(`/rnet/v0/vibes/${vibeUuid}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: source.source },
    });
    expect(gapResponse.status).toBe(422);
    const gap = (await gapResponse.json()) as {
      code: string;
      required_action: {
        action: string;
        continuation_token: string;
        kind: string;
        source: string;
      };
    };
    expect(gap).toMatchObject({
      code: "source_action_required",
      required_action: {
        kind: "source_action_required",
        action: "review_import",
        source: source.source,
      },
    });
    expect(gap.required_action.continuation_token.length).toBeGreaterThan(32);

    const tamperedContinuation =
      gap.required_action.continuation_token.slice(0, -1) +
      (gap.required_action.continuation_token.endsWith("A") ? "B" : "A");
    const tamperedResponse = await request(`/rnet/v0/vibes/${vibeUuid}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: source.source, continuation_token: tamperedContinuation },
    });
    expect(tamperedResponse.status).toBe(422);
    expect(await tamperedResponse.json()).toMatchObject({
      code: "schema_violation",
      title: "Continuation invalid",
      detail: "The source continuation token is invalid or expired",
    });
    const ownerPullGapResponse = await request(`/rnet/v0/vibes/${vibeUuid}/pull`, {
      method: "POST",
      headers: owner,
      json: {},
    });
    expect(ownerPullGapResponse.status).toBe(422);
    const ownerPullGap = await ownerPullGapResponse.json();
    expect(ownerPullGap).toMatchObject({
      code: "source_action_required",
      required_action: {
        action: "review_import",
        source: source.source,
      },
    });
    expect(JSON.stringify(ownerPullGap)).not.toContain(
      new Date(previousBalanceAt * 1_000).toISOString(),
    );

    const delegatedPullGapResponse = await request(`/rnet/v0/vibes/${vibeUuid}/pull`, {
      method: "POST",
      headers: dmachine,
      json: {},
    });
    expect(delegatedPullGapResponse.status).toBe(422);
    const delegatedPullGap = await delegatedPullGapResponse.json();
    expect(delegatedPullGap).toMatchObject({
      action: "review_import",
      code: "source_action_required",
      owner_action_required: true,
    });
    expect(delegatedPullGap).not.toHaveProperty("required_action");
    expect(JSON.stringify(delegatedPullGap)).not.toContain(source.source);
    expect(JSON.stringify(delegatedPullGap)).not.toContain(
      new Date(previousBalanceAt * 1_000).toISOString(),
    );
    expect(
      simpleFinRequests.filter((providerRequest) => providerRequest.method === "GET"),
    ).toHaveLength(providerRequestsBeforeGap);
    expect(await connectedFetches(sourceUuid(source.source), "committed")).toHaveLength(1);

    const currentBytes = simpleFinAccountSetBytes({
      balance: "125.00",
      balanceAtEpoch: nowEpoch - 60,
    });
    simpleFinAccountResponses.push(currentBytes);
    const recoveryResponse = await request(`/rnet/v0/vibes/${vibeUuid}/imports`, {
      method: "POST",
      headers: owner,
      json: {
        source: source.source,
        continuation_token: gap.required_action.continuation_token,
      },
    });
    expect(recoveryResponse.status).toBe(202);
    const recovery = await waitForOperation(await recoveryResponse.json(), owner);
    expect(recovery.status).toBe("done");
    expect(recovery.request).toEqual({
      mode: "import_preview",
      source: source.source,
      continuation_action: "review_import",
    });
    expect(JSON.stringify(recovery.request)).not.toContain(gap.required_action.continuation_token);
    const recoveryResult = recovery.result as {
      staged_origin: string;
      verify: {
        ok: boolean;
        history_recovery?: {
          mode: string;
          reason: string;
          previous_balance_at: string;
          history_resumes_at: string;
        };
        balance_delta_baselines: unknown[];
        checks: Array<{ name: string; ok: boolean }>;
      };
    };
    expect(recoveryResult.verify).toMatchObject({
      ok: true,
      history_recovery: {
        mode: "rebaseline",
        reason: "simplefin_history_gap",
        previous_balance_at: new Date(previousBalanceAt * 1_000).toISOString(),
      },
      balance_delta_baselines: [{ account_index: 1 }],
    });
    expect(recovery.result).toMatchObject({ action_evidence: { kind: "review_import" } });
    expect(recoveryResult.verify.checks).toContainEqual(
      expect.objectContaining({ name: "history_recovery", ok: true }),
    );
    const recoveryRequest = [...simpleFinRequests]
      .reverse()
      .find((providerRequest) => providerRequest.method === "GET");
    expect(recoveryRequest).toBeDefined();
    const recoveryUrl = new URL(recoveryRequest!.url);
    expect(
      Number(recoveryUrl.searchParams.get("end-date")) -
        Number(recoveryUrl.searchParams.get("start-date")),
    ).toBe(45 * day);
    const stagedBytesResponse = await request(
      `/rnet/v0/origins/${recoveryResult.staged_origin.split("/").at(-1)}/bytes`,
      { headers: owner },
    );
    expect(stagedBytesResponse.status).toBe(200);
    expect(Array.from(new Uint8Array(await stagedBytesResponse.arrayBuffer()))).toEqual(
      Array.from(currentBytes),
    );
    expect(await connectedFetches(sourceUuid(source.source), "committed")).toHaveLength(1);
    expect(await connectedFetches(sourceUuid(source.source), "verified")).toHaveLength(1);

    const confirmRecovery = await request(
      `/rnet/v0/vibes/${vibeUuid}/imports/${recovery.operation_id}/confirm`,
      { method: "POST", headers: owner },
    );
    expect(confirmRecovery.status).toBe(200);
    expect(await connectedFetches(sourceUuid(source.source), "committed")).toHaveLength(2);
    expect(await connectedFetches(sourceUuid(source.source), "verified")).toHaveLength(0);

    const unreconciledBytes = simpleFinAccountSetBytes({
      balance: "130.00",
      balanceAtEpoch: nowEpoch,
    });
    simpleFinAccountResponses.push(unreconciledBytes);
    const unreconciledResponse = await request(`/rnet/v0/vibes/${vibeUuid}/pull`, {
      method: "POST",
      headers: owner,
      json: {},
    });
    expect(unreconciledResponse.status).toBe(202);
    const unreconciled = await waitForOperation(await unreconciledResponse.json(), owner);
    expect(unreconciled).toMatchObject({
      status: "failed",
      result: {
        code: "source_action_required",
        required_action: {
          kind: "source_action_required",
          action: "review_import",
          source: source.source,
        },
      },
    });
    expect(unreconciled.error).toContain("Review and acknowledge");
    const activityContinuation = (
      unreconciled.result as {
        required_action: { continuation_token: string };
      }
    ).required_action.continuation_token;

    const delegatedUnreconciledResponse = await request(
      `/rnet/v0/operations/${unreconciled.operation_id}`,
      { headers: dmachine },
    );
    expect(delegatedUnreconciledResponse.status).toBe(200);
    const delegatedUnreconciled = await delegatedUnreconciledResponse.json();
    expect(delegatedUnreconciled.result).toEqual({
      action: "review_import",
      code: "source_action_required",
      owner_action_required: true,
    });
    expect(delegatedUnreconciled.error).toBe(
      "The connected source owner must review an import before pulling again.",
    );
    expect(JSON.stringify(delegatedUnreconciled)).not.toContain(source.source);
    expect(JSON.stringify(delegatedUnreconciled)).not.toContain("unreconciled_backdated_activity");
    expect(JSON.stringify(delegatedUnreconciled)).not.toContain(activityContinuation);

    simpleFinAccountResponses.push(unreconciledBytes);
    const activityRecoveryResponse = await request(`/rnet/v0/vibes/${vibeUuid}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: source.source, continuation_token: activityContinuation },
    });
    expect(activityRecoveryResponse.status).toBe(202);
    const activityRecovery = await waitForOperation(await activityRecoveryResponse.json(), owner);
    expect(activityRecovery).toMatchObject({
      status: "done",
      result: {
        action_evidence: { kind: "review_import" },
        verify: {
          ok: true,
          history_recovery: {
            mode: "rebaseline",
            reason: "unreconciled_backdated_activity",
          },
        },
      },
    });
  });

  test("does not count credential decryption failures as SimpleFIN fetch attempts", async () => {
    const fixture = await createStoredSimpleFinCredential(1);
    const source = fixture.sources[0]!;
    const vibeResponse = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: { title: "Credential decrypt failure" },
    });
    expect(vibeResponse.status).toBe(201);
    const vibeUuid = ((await vibeResponse.json()) as { uri: string }).uri.split("/").at(-1)!;
    const providerRequestsBefore = simpleFinRequests.filter(
      (request) => request.method === "GET",
    ).length;
    const [fetchCountBefore] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(ingestionSourceFetches)
      .where(eq(ingestionSourceFetches.credentialUuid, fixture.credentialUuid));

    await db
      .update(sourceCredentials)
      .set({ secret: Uint8Array.of(2) })
      .where(eq(sourceCredentials.uuid, fixture.credentialUuid));
    const previewResponse = await request(`/rnet/v0/vibes/${vibeUuid}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: source.source },
    });
    expect(previewResponse.status).toBe(202);
    const failed = await waitForOperation(await previewResponse.json(), owner);

    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("Credential secret envelope is invalid");
    expect(simpleFinRequests.filter((request) => request.method === "GET")).toHaveLength(
      providerRequestsBefore,
    );
    expect(
      await db
        .select()
        .from(ingestionSourceFetches)
        .where(eq(ingestionSourceFetches.operationUuid, failed.operation_id)),
    ).toHaveLength(0);
    const [fetchCountAfter] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(ingestionSourceFetches)
      .where(eq(ingestionSourceFetches.credentialUuid, fixture.credentialUuid));
    expect(fetchCountAfter?.count).toBe(fetchCountBefore?.count ?? 0);
  });

  test("linearizes credential revocation after an in-flight SimpleFIN request", async () => {
    const fixture = await createStoredSimpleFinCredential(1);
    const source = fixture.sources[0]!;
    const vibeResponse = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: { title: "Revocation lease" },
    });
    expect(vibeResponse.status).toBe(201);
    const vibeUuid = ((await vibeResponse.json()) as { uri: string }).uri.split("/").at(-1)!;

    let signalStarted!: () => void;
    let releaseProvider!: (bytes: Uint8Array) => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const providerResponse = new Promise<Uint8Array>((resolve) => {
      releaseProvider = resolve;
    });
    simpleFinAccountFetches.push(async () => {
      signalStarted();
      return providerResponse;
    });

    const previewResponse = await request(`/rnet/v0/vibes/${vibeUuid}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: source.source },
    });
    expect(previewResponse.status).toBe(202);
    const accepted = (await previewResponse.json()) as OperationDocument;
    await started;

    const revoke = request(`/rnet/v0/source-credentials/${fixture.credentialUuid}`, {
      method: "DELETE",
      headers: owner,
    });
    const earlyOutcome = await Promise.race([
      revoke.then(() => "revoked" as const),
      Bun.sleep(50).then(() => "pending" as const),
    ]);
    expect(earlyOutcome).toBe("pending");

    releaseProvider(await simpleFinFixtureBytes("accounts-current-v2.json"));
    expect((await revoke).status).toBe(204);
    const preview = await waitForOperation(accepted, owner);
    expect(preview.status).toBe("done");
    const [fetch] = await db
      .select()
      .from(ingestionSourceFetches)
      .where(eq(ingestionSourceFetches.operationUuid, preview.operation_id));
    expect(fetch).toMatchObject({
      credentialUuid: fixture.credentialUuid,
      sourceUuid: source.source.slice("source:".length),
      status: "verified",
    });
  });

  test("serializes and limits account fetches across every source sharing a credential", async () => {
    const fixture = await createStoredSimpleFinCredential(2);
    const firstSourceUuid = fixture.sources[0]!.source.slice("source:".length);
    const seededOperations = Array.from({ length: 23 }, () => uuidv7());
    await db.insert(operations).values(
      seededOperations.map((uuid) => ({
        uuid,
        kind: "pull" as const,
        status: "failed" as const,
        invokedBy: `id:rnet://id/${DEV_USER_UUID}`,
        request: { mode: "rate-limit-fixture" },
        error: "seeded provider attempt",
        finishedAt: new Date(),
      })),
    );
    await db.insert(ingestionSourceFetches).values(
      seededOperations.map((operationUuid) => ({
        uuid: uuidv7(),
        sourceUuid: firstSourceUuid,
        ownerUuid: DEV_USER_UUID,
        credentialUuid: fixture.credentialUuid,
        operationUuid,
        connectorVersion: SIMPLEFIN_CONNECTOR_VERSION,
        parserVersion: "simplefin@2.0.0",
        sourceStateDigest: "sha256:rate-limit-fixture",
        status: "rejected" as const,
        errorCode: "fetch_failed",
      })),
    );

    const vibeResponse = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: { title: "Credential-wide provider limit" },
    });
    expect(vibeResponse.status).toBe(201);
    const vibeUuid = ((await vibeResponse.json()) as { uri: string }).uri.split("/").at(-1)!;
    const accountRequestsBefore = simpleFinRequests.filter(
      (request) => request.method === "GET",
    ).length;

    let signalStarted!: () => void;
    let releaseProvider!: (bytes: Uint8Array) => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const providerResponse = new Promise<Uint8Array>((resolve) => {
      releaseProvider = resolve;
    });
    simpleFinAccountFetches.push(async () => {
      signalStarted();
      return providerResponse;
    });
    const activeResponse = await request(`/rnet/v0/vibes/${vibeUuid}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: fixture.sources[0]!.source },
    });
    expect(activeResponse.status).toBe(202);
    const active = (await activeResponse.json()) as OperationDocument;
    await started;

    const concurrentResponse = await request(`/rnet/v0/vibes/${vibeUuid}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: fixture.sources[1]!.source },
    });
    expect(concurrentResponse.status).toBe(202);
    const concurrent = await waitForOperation(await concurrentResponse.json(), owner);
    expect(concurrent.status).toBe("failed");
    expect(concurrent.error).toContain("active credential fetch");
    expect(simpleFinRequests.filter((request) => request.method === "GET")).toHaveLength(
      accountRequestsBefore + 1,
    );

    const [reservedCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(ingestionSourceFetches)
      .where(eq(ingestionSourceFetches.credentialUuid, fixture.credentialUuid));
    expect(reservedCount?.count).toBe(24);

    releaseProvider(await simpleFinFixtureBytes("accounts-current-v2.json"));
    expect((await waitForOperation(active, owner)).status).toBe("done");

    const limitedResponse = await request(`/rnet/v0/vibes/${vibeUuid}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: fixture.sources[1]!.source },
    });
    const limited = await waitForOperation(await limitedResponse.json(), owner);
    expect(limited.status).toBe("failed");
    expect(limited.error).toContain("24 account fetches");
    expect(simpleFinRequests.filter((request) => request.method === "GET")).toHaveLength(
      accountRequestsBefore + 1,
    );
  });

  test("creates a Vibe with a real dMachine grant", async () => {
    const response = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: {
        title: "Spending",
        grants: [
          {
            subject: "client:rbudget",
            scope: ["read", "write:user", "write:objects", "write:inferred"],
          },
        ],
      },
    });
    expect(response.status).toBe(201);
    const vibe = await response.json();
    expect(vibe.title).toBe("Spending");
    expect(vibe.owner).toBe("rnet://id/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47");
    vibeId = vibe.uri.split("/").at(-1);
  });

  test("lists Vibes granted to a user alongside their owned Vibes", async () => {
    const created = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: {
        title: "Shared with another user",
        grants: [
          {
            subject: "id:rnet://id/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b49",
            scope: ["read"],
          },
        ],
      },
    });
    expect(created.status).toBe(201);
    const shared = await created.json();

    const owned = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: otherOwner,
      json: { title: "Owned by the granted user" },
    });
    expect(owned.status).toBe(201);
    const ownedVibe = await owned.json();

    const response = await request("/rnet/v0/vibes", { headers: otherOwner });
    expect(response.status).toBe(200);
    const collection = await response.json();
    const uris = collection.vibes.map((vibe: { uri: string }) => vibe.uri);
    expect(uris).toContain(shared.uri);
    expect(uris).toContain(ownedVibe.uri);
  });

  test("rejects grant subjects the store cannot resolve", async () => {
    const response = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: { title: "Bad grant", grants: [{ subject: "x-ghost:anyone", scope: ["read"] }] },
    });
    expect(response.status).toBe(422);
  });

  test("rejects non-UUIDv7 user grant subjects at the route boundary", async () => {
    const response = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: {
        title: "Bad user grant",
        grants: [{ subject: "id:rnet://id/alice", scope: ["read"] }],
      },
    });
    expect(response.status).toBe(422);
  });

  test("creates distinct owned origin records while deduplicating payload bytes", async () => {
    const first = await app.request("http://rhizome.test/rnet/v0/origins", {
      method: "POST",
      headers: { ...owner, "Content-Type": "application/json", "X-Rnet-Label": "bank.json" },
      body: '{"transactions":[]}',
    });
    expect(first.status).toBe(201);
    const origin = await first.json();
    originUri = origin.uri;
    originHash = origin.content_hash;
    expect(origin.owner).toBe("rnet://id/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47");
    expect(origin.uri).toMatch(/^rnet:\/\/origin\/[0-9a-f-]{36}$/);
    const second = await app.request("http://rhizome.test/rnet/v0/origins", {
      method: "POST",
      headers: { ...owner, "Content-Type": "application/json" },
      body: '{"transactions":[]}',
    });
    expect(second.status).toBe(201);
    const duplicate = await second.json();
    expect(duplicate.uri).not.toBe(originUri);
    expect(duplicate.content_hash).toBe(originHash);
  });

  test("stages, verifies, and atomically confirms supported CSV and QFX imports", async () => {
    const vibeResponse = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: {
        title: "Reviewed imports",
        grants: [{ subject: "client:rbudget", scope: ["pull"] }],
      },
    });
    expect(vibeResponse.status).toBe(201);
    const importVibe = await vibeResponse.json();
    const importVibeId = importVibe.uri.split("/").at(-1);

    const csvBytes = await Bun.file(
      new URL("../../ingest/skills/csv/fixtures/rhizome-bank.csv", import.meta.url),
    ).text();
    const csvOriginResponse = await app.request("http://rhizome.test/rnet/v0/origins", {
      method: "POST",
      headers: { ...owner, "Content-Type": "text/csv", "X-Rnet-Label": "rhizome-bank.csv" },
      body: csvBytes,
    });
    expect(csvOriginResponse.status).toBe(201);
    const csvOrigin = await csvOriginResponse.json();

    expect(
      (
        await request("/rnet/v0/ingestion-sources", {
          method: "POST",
          headers: otherOwner,
          json: { origin: csvOrigin.uri, skill_id: "csv" },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request("/rnet/v0/ingestion-sources", {
          method: "POST",
          headers: dmachine,
          json: { origin: csvOrigin.uri, skill_id: "csv" },
        })
      ).status,
    ).toBe(403);

    const csvSourceResponse = await request("/rnet/v0/ingestion-sources", {
      method: "POST",
      headers: owner,
      json: { origin: csvOrigin.uri, skill_id: "csv" },
    });
    expect(csvSourceResponse.status).toBe(201);
    const csvSource = await csvSourceResponse.json();
    expect(csvSource).toMatchObject({
      kind: "origin",
      skill_id: "csv",
      parser: "csv",
      parser_version: "csv@1.1.0",
      origin: csvOrigin.uri,
    });

    const [beforeCsv] = await client.unsafe("select count(*)::int as count from media_objects");
    const csvPreviewResponse = await request(`/rnet/v0/vibes/${importVibeId}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: csvSource.source },
    });
    expect(csvPreviewResponse.status).toBe(202);
    const csvPreview = await waitForOperation(await csvPreviewResponse.json(), owner);
    expect(csvPreview.status).toBe("done");
    expect(csvPreview.result).toMatchObject({
      verify: {
        ok: true,
        source_record_count: 3,
        candidate_count: 3,
        totals_by_currency: { USD: "2410.25" },
      },
    });
    expect((csvPreview.result as { candidates: unknown[] }).candidates).toHaveLength(3);
    expect(
      (csvPreview.result as { candidates: Array<{ source: { ingest: { skill?: string } } }> })
        .candidates[0]?.source.ingest.skill,
    ).toBe("csv@1.1.0");
    const [afterPreview] = await client.unsafe("select count(*)::int as count from media_objects");
    expect(afterPreview?.count).toBe(beforeCsv?.count);

    const confirmedCsv = await request(
      `/rnet/v0/vibes/${importVibeId}/imports/${csvPreview.operation_id}/confirm`,
      { method: "POST", headers: owner },
    );
    expect(confirmedCsv.status).toBe(200);
    const csvVibe = await confirmedCsv.json();
    expect(csvVibe.objects).toHaveLength(3);
    expect(csvVibe.pull.sources).toContain(csvSource.source);
    const [afterConfirm] = await client.unsafe("select count(*)::int as count from media_objects");
    expect(afterConfirm?.count).toBe((beforeCsv?.count ?? 0) + 3);
    expect(
      (
        await request(`/rnet/v0/vibes/${importVibeId}/imports/${csvPreview.operation_id}/confirm`, {
          method: "POST",
          headers: owner,
        })
      ).status,
    ).toBe(422);
    expect(await mediaObjectCount()).toBe(afterConfirm?.count);

    const canceledPreviewResponse = await request(`/rnet/v0/vibes/${importVibeId}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: csvSource.source },
    });
    const canceledPreview = await waitForOperation(await canceledPreviewResponse.json(), owner);
    expect(canceledPreview.status).toBe("done");
    const [afterCancel] = await client.unsafe("select count(*)::int as count from media_objects");
    expect(afterCancel?.count).toBe(afterConfirm?.count);

    const qfxBytes = await Bun.file(
      new URL("../../ingest/skills/ofx/fixtures/checking.qfx", import.meta.url),
    ).text();
    const qfxOriginResponse = await app.request("http://rhizome.test/rnet/v0/origins", {
      method: "POST",
      headers: {
        ...owner,
        "Content-Type": "application/x-ofx",
        "X-Rnet-Label": "checking.qfx",
      },
      body: qfxBytes,
    });
    const qfxOrigin = await qfxOriginResponse.json();
    const qfxSourceResponse = await request("/rnet/v0/ingestion-sources", {
      method: "POST",
      headers: owner,
      json: { origin: qfxOrigin.uri, skill_id: "ofx" },
    });
    const qfxSource = await qfxSourceResponse.json();
    const qfxPreviewResponse = await request(`/rnet/v0/vibes/${importVibeId}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: qfxSource.source },
    });
    const qfxPreview = await waitForOperation(await qfxPreviewResponse.json(), owner);
    expect(qfxPreview.result).toMatchObject({
      verify: { ok: true, candidate_count: 2, totals_by_currency: { USD: "2493.50" } },
    });
    const confirmedQfx = await request(
      `/rnet/v0/vibes/${importVibeId}/imports/${qfxPreview.operation_id}/confirm`,
      { method: "POST", headers: owner },
    );
    expect(confirmedQfx.status).toBe(200);
    expect((await confirmedQfx.json()).objects).toHaveLength(5);

    const [beforePull] = await client.unsafe("select count(*)::int as count from media_objects");
    const dryRunResponse = await request(`/rnet/v0/vibes/${importVibeId}/pull`, {
      method: "POST",
      headers: owner,
      json: { dry_run: true },
    });
    expect(dryRunResponse.status).toBe(202);
    const dryRun = await waitForOperation(await dryRunResponse.json(), owner);
    expect(dryRun.status).toBe("done");
    expect(dryRun.committed_at).toBeUndefined();
    expect(dryRun.result).toMatchObject({
      dry_run: true,
      policy: "append_new",
      candidate_count: 5,
      duplicate_count: 5,
      added_count: 0,
      created_count: 0,
      removed_count: 0,
    });
    expect(
      (await client.unsafe("select count(*)::int as count from media_objects"))[0]?.count,
    ).toBe(beforePull?.count);

    const delegatedPullResponse = await request(`/rnet/v0/vibes/${importVibeId}/pull`, {
      method: "POST",
      headers: dmachine,
      json: {},
    });
    expect(delegatedPullResponse.status).toBe(202);
    const delegatedPull = await waitForOperation(await delegatedPullResponse.json(), dmachine);
    expect(delegatedPull.status).toBe("done");
    expect(delegatedPull.committed_at).toBeString();
    expect(delegatedPull.result).toMatchObject({
      dry_run: false,
      policy: "append_new",
      candidate_count: 5,
      duplicate_count: 5,
      added_count: 0,
      created_count: 0,
    });
    expect(
      (await client.unsafe("select count(*)::int as count from media_objects"))[0]?.count,
    ).toBe(beforePull?.count);
    expect(
      (
        await request(`/rnet/v0/vibes/${importVibeId}/pull`, {
          method: "POST",
          headers: otherOwner,
          json: {},
        })
      ).status,
    ).toBe(403);

    const suggestOnlyVibeResponse = await request(`/rnet/v0/vibes/${importVibeId}`, {
      method: "PATCH",
      headers: owner,
      json: {
        pull: {
          enabled: true,
          sources: [csvSource.source, qfxSource.source],
          policy: "suggest_only",
        },
      },
    });
    expect(suggestOnlyVibeResponse.status).toBe(200);
    const suggestOnlyResponse = await request(`/rnet/v0/vibes/${importVibeId}/pull`, {
      method: "POST",
      headers: owner,
      json: {},
    });
    const suggestOnly = await waitForOperation(await suggestOnlyResponse.json(), owner);
    expect(suggestOnly.committed_at).toBeUndefined();
    expect(suggestOnly.result).toMatchObject({
      policy: "suggest_only",
      candidate_count: 5,
      duplicate_count: 5,
      added_count: 0,
      created_count: 0,
    });

    const replaceVibeResponse = await request(`/rnet/v0/vibes/${importVibeId}`, {
      method: "PATCH",
      headers: owner,
      json: {
        pull: {
          enabled: true,
          sources: [csvSource.source, qfxSource.source],
          policy: "replace",
        },
      },
    });
    expect(replaceVibeResponse.status).toBe(200);
    const replaceResponse = await request(`/rnet/v0/vibes/${importVibeId}/pull`, {
      method: "POST",
      headers: owner,
      json: {},
    });
    const replace = await waitForOperation(await replaceResponse.json(), owner);
    expect(replace.result).toMatchObject({
      policy: "replace",
      candidate_count: 5,
      duplicate_count: 5,
      added_count: 5,
      created_count: 0,
      removed_count: 5,
    });
    const replacedVibe = await request(`/rnet/v0/vibes/${importVibeId}`, { headers: owner });
    expect((await replacedVibe.json()).objects).toHaveLength(5);
    expect(
      (await client.unsafe("select count(*)::int as count from media_objects"))[0]?.count,
    ).toBe(beforePull?.count);
    expect(
      (await request(`/rnet/v0/origins/${csvOrigin.uri.split("/").at(-1)}`, { headers: owner }))
        .status,
    ).toBe(200);

    const removeSourceResponse = await request(`/rnet/v0/vibes/${importVibeId}`, {
      method: "PATCH",
      headers: owner,
      json: {
        pull: {
          enabled: false,
          sources: [csvSource.source],
          policy: "append_new",
        },
      },
    });
    expect(removeSourceResponse.status).toBe(200);
    expect((await removeSourceResponse.json()).pull).toMatchObject({
      enabled: false,
      sources: [csvSource.source],
      policy: "append_new",
    });
  });

  test("reuses a confirmed source within and across Vibes without partial derived state", async () => {
    const fixture = await createCsvSourceFixture("repeat-review.csv");
    const firstVibeResponse = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: { title: "First source target" },
    });
    const secondVibeResponse = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: { title: "Second source target" },
    });
    expect(firstVibeResponse.status).toBe(201);
    expect(secondVibeResponse.status).toBe(201);
    const firstVibeId = ((await firstVibeResponse.json()) as { uri: string }).uri
      .split("/")
      .at(-1)!;
    const secondVibeId = ((await secondVibeResponse.json()) as { uri: string }).uri
      .split("/")
      .at(-1)!;

    const confirmPreview = async (targetVibeId: string) => {
      const previewResponse = await request(`/rnet/v0/vibes/${targetVibeId}/imports`, {
        method: "POST",
        headers: owner,
        json: { source: fixture.source.source },
      });
      expect(previewResponse.status).toBe(202);
      const preview = await waitForOperation(await previewResponse.json(), owner);
      expect(preview.status).toBe("done");
      const confirmResponse = await request(
        `/rnet/v0/vibes/${targetVibeId}/imports/${preview.operation_id}/confirm`,
        { method: "POST", headers: owner },
      );
      expect(confirmResponse.status).toBe(200);
      return (await confirmResponse.json()) as { objects: string[]; pull: { sources: string[] } };
    };

    const firstConfirmation = await confirmPreview(firstVibeId);
    expect(firstConfirmation.objects).toHaveLength(3);
    const persistedObjectUris = firstConfirmation.objects;
    const objectCount = await mediaObjectCount();
    expect(await sourceBindingCount(fixture.source.source)).toBe(3);

    const repeatedConfirmation = await confirmPreview(firstVibeId);
    expect(repeatedConfirmation.objects).toEqual(persistedObjectUris);
    expect(repeatedConfirmation.pull.sources).toContain(fixture.source.source);
    expect(await mediaObjectCount()).toBe(objectCount);
    expect(await sourceBindingCount(fixture.source.source)).toBe(3);

    const crossVibeConfirmation = await confirmPreview(secondVibeId);
    expect(crossVibeConfirmation.objects).toEqual(persistedObjectUris);
    expect(crossVibeConfirmation.pull.sources).toContain(fixture.source.source);
    expect(await mediaObjectCount()).toBe(objectCount);
    expect(await sourceBindingCount(fixture.source.source)).toBe(3);
  });

  test("only reviewed confirmation can introduce a source and cancellation leaves no derived state", async () => {
    const fixture = await createCsvSourceFixture("cancel-review.csv");
    const [beforeObjects] = await client.unsafe("select count(*)::int as count from media_objects");

    const createBypass = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: {
        title: "Unreviewed source on create",
        pull: {
          enabled: true,
          sources: [fixture.source.source],
          policy: "append_new",
        },
      },
    });
    expect(createBypass.status).toBe(422);
    expect((await createBypass.json()).code).toBe("import_review_invalid");

    const vibeResponse = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: { title: "Canceled import" },
    });
    expect(vibeResponse.status).toBe(201);
    const vibe = await vibeResponse.json();
    const vibeId = vibe.uri.split("/").at(-1);

    const patchBypass = await request(`/rnet/v0/vibes/${vibeId}`, {
      method: "PATCH",
      headers: owner,
      json: {
        pull: {
          enabled: true,
          sources: [fixture.source.source],
          policy: "append_new",
        },
      },
    });
    expect(patchBypass.status).toBe(422);
    expect((await patchBypass.json()).code).toBe("import_review_invalid");
    expect(
      (
        await request(`/rnet/v0/vibes/${vibeId}/pull`, {
          method: "POST",
          headers: owner,
          json: {},
        })
      ).status,
    ).toBe(422);

    const previewResponse = await request(`/rnet/v0/vibes/${vibeId}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: fixture.source.source },
    });
    expect(previewResponse.status).toBe(202);
    const preview = await waitForOperation(await previewResponse.json(), owner);
    expect(preview.status).toBe("done");
    expect(preview.committed_at).toBeUndefined();

    // Leaving the completed review unconfirmed is the cancellation boundary. The owner-only
    // origin and source remain for audit/retry, while all derived state stays untouched.
    const afterCancel = await request(`/rnet/v0/vibes/${vibeId}`, { headers: owner });
    const canceledVibe = await afterCancel.json();
    expect(canceledVibe.objects).toEqual([]);
    expect(canceledVibe.pull?.sources ?? []).toEqual([]);
    expect(await mediaObjectCount()).toBe(beforeObjects?.count);
    expect(await sourceBindingCount(fixture.source.source)).toBe(0);
    expect(
      (
        await request(`/rnet/v0/origins/${fixture.origin.uri.split("/").at(-1)}`, {
          headers: owner,
        })
      ).status,
    ).toBe(200);
    const [retainedSource] = await client.unsafe(
      "select count(*)::int as count from ingestion_sources where uuid = $1 and revoked_at is null",
      [sourceUuid(fixture.source.source)],
    );
    expect(retainedSource?.count).toBe(1);
  });

  test("wrong-Vibe and tampered reviews fail without consuming or partially committing", async () => {
    const fixture = await createCsvSourceFixture("tampered-review.csv");
    const targetResponse = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: { title: "Digest target" },
    });
    const wrongVibeResponse = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: { title: "Wrong digest target" },
    });
    const target = await targetResponse.json();
    const wrongVibe = await wrongVibeResponse.json();
    const targetId = target.uri.split("/").at(-1);
    const wrongVibeId = wrongVibe.uri.split("/").at(-1);
    const beforeObjects = await mediaObjectCount();

    const previewResponse = await request(`/rnet/v0/vibes/${targetId}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: fixture.source.source },
    });
    const preview = await waitForOperation(await previewResponse.json(), owner);
    expect(preview.status).toBe("done");

    const wrongConfirm = await request(
      `/rnet/v0/vibes/${wrongVibeId}/imports/${preview.operation_id}/confirm`,
      { method: "POST", headers: owner },
    );
    expect(wrongConfirm.status).toBe(422);
    expect((await wrongConfirm.json()).code).toBe("import_review_invalid");

    await client.unsafe(
      `update operations
       set result = jsonb_set(
         result,
         '{candidates,0,source,properties,amount}',
         to_jsonb('999.99'::text)
       )
       where uuid = $1`,
      [preview.operation_id],
    );
    const tamperedConfirm = await request(
      `/rnet/v0/vibes/${targetId}/imports/${preview.operation_id}/confirm`,
      { method: "POST", headers: owner },
    );
    expect(tamperedConfirm.status).toBe(422);
    expect((await tamperedConfirm.json()).code).toBe("import_review_invalid");
    expect(await mediaObjectCount()).toBe(beforeObjects);
    expect(await sourceBindingCount(fixture.source.source)).toBe(0);
    const unchangedTarget = await request(`/rnet/v0/vibes/${targetId}`, { headers: owner });
    const targetVibe = await unchangedTarget.json();
    expect(targetVibe.objects).toEqual([]);
    expect(targetVibe.pull?.sources ?? []).toEqual([]);
    const operationAfterFailures = await request(`/rnet/v0/operations/${preview.operation_id}`, {
      headers: owner,
    });
    expect((await operationAfterFailures.json()).committed_at).toBeUndefined();
  });

  test("tombstoning an origin after preview makes the review stale without writes", async () => {
    const fixture = await createCsvSourceFixture("tombstoned-review.csv");
    const vibeResponse = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: { title: "Tombstoned origin review" },
    });
    const vibe = await vibeResponse.json();
    const vibeId = vibe.uri.split("/").at(-1);
    const beforeObjects = await mediaObjectCount();
    const previewResponse = await request(`/rnet/v0/vibes/${vibeId}/imports`, {
      method: "POST",
      headers: owner,
      json: { source: fixture.source.source },
    });
    const preview = await waitForOperation(await previewResponse.json(), owner);
    expect(preview.status).toBe("done");

    const originId = fixture.origin.uri.split("/").at(-1);
    expect(
      (await request(`/rnet/v0/origins/${originId}`, { method: "DELETE", headers: owner })).status,
    ).toBe(204);
    const confirm = await request(
      `/rnet/v0/vibes/${vibeId}/imports/${preview.operation_id}/confirm`,
      { method: "POST", headers: owner },
    );
    expect(confirm.status).toBe(404);
    expect(await mediaObjectCount()).toBe(beforeObjects);
    expect(await sourceBindingCount(fixture.source.source)).toBe(0);
    const unchangedVibe = await request(`/rnet/v0/vibes/${vibeId}`, { headers: owner });
    const document = await unchangedVibe.json();
    expect(document.objects).toEqual([]);
    expect(document.pull?.sources ?? []).toEqual([]);
  });

  test("rejects provenance mismatches and malformed extensions before persistence", async () => {
    const [before] = await client.unsafe("select count(*)::int as count from media_objects");
    const authoredFromArtifact = await request("/rnet/v0/objects", {
      method: "POST",
      headers: owner,
      json: {
        objects: [
          {
            type: "note",
            source: {
              ingest: { method: "authored", reproducible: false },
              origins: [originUri],
              properties: {},
            },
          },
        ],
      },
    });
    expect(authoredFromArtifact.status).toBe(422);

    const parsedFromClient = await request("/rnet/v0/objects", {
      method: "POST",
      headers: owner,
      json: {
        objects: [
          {
            type: "note",
            source: {
              ingest: { method: "parser", reproducible: true },
              origins: ["rnet://client/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b48"],
              properties: {},
            },
          },
        ],
      },
    });
    expect(parsedFromClient.status).toBe(422);

    const malformedExtension = await request("/rnet/v0/objects", {
      method: "POST",
      headers: owner,
      json: {
        objects: [
          {
            type: "note",
            source: {
              ingest: { method: "parser", reproducible: true },
              origins: [originUri],
              properties: {},
            },
            "x-": true,
          },
        ],
      },
    });
    expect(malformedExtension.status).toBe(422);
    const [after] = await client.unsafe("select count(*)::int as count from media_objects");
    expect(after?.count).toBe(before?.count);
  });

  test("creates a conformant transaction and attaches it to the Vibe", async () => {
    const response = await request("/rnet/v0/objects", {
      method: "POST",
      headers: owner,
      json: {
        vibe: `rnet://vibe/${vibeId}`,
        objects: [
          {
            type: "transaction",
            elements: [],
            source: {
              ingest: { method: "parser", reproducible: true },
              origins: [originUri],
              properties: { amount: "-6.50", currency: "USD", raw_description: "COFFEE SHOP" },
            },
          },
        ],
      },
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    mediaObjectId = body.mediaObjects[0].uri.split("/").at(-1);
    expect(body.mediaObjects[0].owner).toBe("rnet://id/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47");
  });

  test("rejects malformed task names before persistence", async () => {
    const response = await request(`/rnet/v0/objects/${mediaObjectId}/inferred`, {
      method: "PUT",
      headers: owner,
      json: { task: "bad task", entry: { model: "test/model", properties: {} } },
    });
    expect(response.status).toBe(422);
    const mediaObject = await (
      await request(`/rnet/v0/objects/${mediaObjectId}`, { headers: owner })
    ).json();
    expect(mediaObject.inferred?.["user/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47:bad task"]).toBe(
      undefined,
    );
  });

  test("preserves batch insertion order with unique Vibe positions", async () => {
    const response = await request("/rnet/v0/objects", {
      method: "POST",
      headers: owner,
      json: {
        vibe: `rnet://vibe/${vibeId}`,
        objects: [0, 1].map((index) => ({
          type: "note",
          elements: [],
          source: {
            ingest: { method: "parser", reproducible: true },
            origins: [originUri],
            properties: { title: `Ordered ${index + 1}` },
          },
        })),
      },
    });
    expect(response.status).toBe(201);
    const uris = (await response.json()).mediaObjects.map((item: { uri: string }) => item.uri);
    repeatableMediaObjectUri = uris[0]!;
    const listed = await (
      await request(`/rnet/v0/vibes/${vibeId}/objects`, { headers: owner })
    ).json();
    expect(listed.mediaObjects.slice(-2).map((item: { uri: string }) => item.uri)).toEqual(uris);
    const positions = await client.unsafe(
      "select position from vibe_media_objects where vibe_uuid = $1 order by position",
      [vibeId],
    );
    expect(positions.map((row) => row.position)).toEqual([0, 1, 2]);
  });

  test("allows repeated placements and delete-by-URI removes every occurrence", async () => {
    const add = await request(`/rnet/v0/vibes/${vibeId}/objects`, {
      method: "POST",
      headers: owner,
      json: { objects: [repeatableMediaObjectUri, repeatableMediaObjectUri] },
    });
    expect(add.status).toBe(204);

    const listedAfterAdd = await (
      await request(`/rnet/v0/vibes/${vibeId}/objects`, { headers: owner })
    ).json();
    expect(
      listedAfterAdd.mediaObjects
        .map((item: { uri: string }) => item.uri)
        .filter((uri: string) => uri === repeatableMediaObjectUri),
    ).toEqual([repeatableMediaObjectUri, repeatableMediaObjectUri, repeatableMediaObjectUri]);
    const vibeAfterAdd = await (
      await request(`/rnet/v0/vibes/${vibeId}`, { headers: owner })
    ).json();
    expect(vibeAfterAdd.objects.filter((uri: string) => uri === repeatableMediaObjectUri)).toEqual([
      repeatableMediaObjectUri,
      repeatableMediaObjectUri,
      repeatableMediaObjectUri,
    ]);

    const remove = await request(`/rnet/v0/vibes/${vibeId}/objects`, {
      method: "DELETE",
      headers: owner,
      json: { objects: [repeatableMediaObjectUri] },
    });
    expect(remove.status).toBe(204);

    const listedAfterRemove = await (
      await request(`/rnet/v0/vibes/${vibeId}/objects`, { headers: owner })
    ).json();
    expect(
      listedAfterRemove.mediaObjects.some(
        (item: { uri: string }) => item.uri === repeatableMediaObjectUri,
      ),
    ).toBe(false);
  });

  test("lets a granted dMachine read but never exposes origins", async () => {
    const vibe = await request(`/rnet/v0/vibes/${vibeId}`, { headers: dmachine });
    expect(vibe.status).toBe(200);
    const mediaObjectResponse = await request(`/rnet/v0/objects/${mediaObjectId}`, {
      headers: dmachine,
    });
    expect(mediaObjectResponse.status).toBe(200);
    expect(mediaObjectResponse.headers.get("ETag")).toBeNull();
    const origin = await request(`/rnet/v0/origins/${originUri.split("/").at(-1)}`, {
      headers: dmachine,
    });
    expect(origin.status).toBe(403);
  });

  test("serializes overlapping last-write-wins edits and retains both in history", async () => {
    let startWrites!: () => void;
    const start = new Promise<void>((resolve) => {
      startWrites = resolve;
    });
    const write = async (category: string) => {
      await start;
      return request(`/rnet/v0/objects/${mediaObjectId}/user`, {
        method: "PATCH",
        headers: dmachine,
        json: { properties: { category } },
      });
    };
    const pendingWrites = [write("coffee"), write("food")];
    startWrites();
    const writes = await Promise.all(pendingWrites);
    expect(writes.map(({ status }) => status)).toEqual([200, 200]);
    expect(writes.every((response) => response.headers.get("ETag") === null)).toBe(true);

    const corrupt = await request(`/rnet/v0/objects/${mediaObjectId}/user`, {
      method: "PATCH",
      headers: dmachine,
      json: { properties: {}, source: { properties: { amount: 0 } } },
    });
    expect(corrupt.status).toBe(422);
    const current = (await (
      await request(`/rnet/v0/objects/${mediaObjectId}`, { headers: dmachine })
    ).json()) as MediaObject;
    expect(current.source.properties.amount).toBe("-6.50");

    const history = await db
      .select({ revision: mediaObjectRevisions.rev, snapshot: mediaObjectRevisions.snapshot })
      .from(mediaObjectRevisions)
      .where(
        and(
          eq(mediaObjectRevisions.mediaObjectUuid, mediaObjectId),
          eq(mediaObjectRevisions.block, "user"),
        ),
      )
      .orderBy(asc(mediaObjectRevisions.rev));
    expect(history).toHaveLength(2);
    expect(history.map(({ revision }) => revision)).toEqual([1, 2]);
    expect(history.map(({ snapshot }) => snapshot?.properties)).toEqual(
      expect.arrayContaining([{ category: "coffee" }, { category: "food" }]),
    );
    expect(history.at(-1)?.snapshot?.properties).toEqual(current.user?.properties);
  });

  test("serializes concurrent inferred writes without losing either task", async () => {
    let startWrites!: () => void;
    const start = new Promise<void>((resolve) => {
      startWrites = resolve;
    });
    const write = async (task: string, value: string) => {
      await start;
      return request(`/rnet/v0/objects/${mediaObjectId}/inferred`, {
        method: "PUT",
        headers: dmachine,
        json: {
          task,
          entry: { model: "test/concurrent", properties: { value } },
        },
      });
    };
    const pendingWrites = [write("concurrent_alpha", "alpha"), write("concurrent_beta", "beta")];
    startWrites();
    const writes = await Promise.all(pendingWrites);
    expect(writes.map(({ status }) => status)).toEqual([200, 200]);

    const current = (await (
      await request(`/rnet/v0/objects/${mediaObjectId}`, { headers: dmachine })
    ).json()) as MediaObject;
    expect(current.inferred?.["rbudget:concurrent_alpha"]?.properties).toEqual({ value: "alpha" });
    expect(current.inferred?.["rbudget:concurrent_beta"]?.properties).toEqual({ value: "beta" });

    const history = await db
      .select({ revision: mediaObjectRevisions.rev, snapshot: mediaObjectRevisions.snapshot })
      .from(mediaObjectRevisions)
      .where(
        and(
          eq(mediaObjectRevisions.mediaObjectUuid, mediaObjectId),
          eq(mediaObjectRevisions.block, "inferred"),
        ),
      )
      .orderBy(asc(mediaObjectRevisions.rev));
    expect(history.map(({ revision }) => revision)).toEqual([1, 2]);
    expect(history.at(-1)?.snapshot).toMatchObject({
      "rbudget:concurrent_alpha": { properties: { value: "alpha" } },
      "rbudget:concurrent_beta": { properties: { value: "beta" } },
    });
  });

  test("server-grounds client-authored objects and prefixes inference", async () => {
    const clientSuppliedSource = await request("/rnet/v0/objects", {
      method: "POST",
      headers: dmachine,
      json: {
        vibe: `rnet://vibe/${vibeId}`,
        objects: [
          {
            type: "note",
            source: {
              ingest: { method: "authored", reproducible: false },
              origins: ["rnet://client/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b48"],
              properties: { title: "Must not be silently discarded" },
            },
          },
        ],
      },
    });
    expect(clientSuppliedSource.status).toBe(422);

    const ownerWithoutSource = await request("/rnet/v0/objects", {
      method: "POST",
      headers: owner,
      json: { objects: [{ type: "note" }] },
    });
    expect(ownerWithoutSource.status).toBe(422);

    const detachedUpload = await app.request("http://rhizome.test/rnet/v0/elements", {
      method: "POST",
      headers: { ...dmachine, "Content-Type": "text/plain", "X-Rnet-Kind": "text" },
      body: "Detached dMachine upload",
    });
    expect(detachedUpload.status).toBe(403);

    const [beforeRejectedUpload] = await client.unsafe(
      "select count(*)::int as elements from media_elements",
    );
    const missingUpload = await request("/rnet/v0/objects", {
      method: "POST",
      headers: dmachine,
      json: {
        vibe: `rnet://vibe/${vibeId}`,
        objects: [
          {
            type: "note",
            elements: [{ upload: "missing", kind: "text", mime: "text/plain" }],
            properties: { title: "Must not commit" },
          },
        ],
      },
    });
    expect(missingUpload.status).toBe(422);
    const [afterRejectedUpload] = await client.unsafe(
      "select count(*)::int as elements from media_elements",
    );
    expect(afterRejectedUpload?.elements).toBe(beforeRejectedUpload?.elements);

    const unreferencedUpload = await request("/rnet/v0/objects", {
      method: "POST",
      headers: dmachine,
      json: {
        vibe: `rnet://vibe/${vibeId}`,
        objects: [{ type: "note", properties: { title: "Must reference its upload" } }],
      },
      uploads: { stray: { bytes: "Unreferenced bytes", mime: "text/plain" } },
    });
    expect(unreferencedUpload.status).toBe(422);
    const [afterUnreferencedUpload] = await client.unsafe(
      "select count(*)::int as elements from media_elements",
    );
    expect(afterUnreferencedUpload?.elements).toBe(beforeRejectedUpload?.elements);

    const created = await request("/rnet/v0/objects", {
      method: "POST",
      headers: dmachine,
      json: {
        vibe: `rnet://vibe/${vibeId}`,
        objects: [
          {
            type: "note",
            elements: [{ upload: "note", kind: "text", mime: "text/plain" }],
            properties: { title: "dMachine-authored" },
          },
        ],
      },
      uploads: {
        note: { bytes: "A dMachine-authored note", mime: "text/plain" },
      },
    });
    expect(created.status).toBe(201);
    const document = (await created.json()).mediaObjects[0];
    expect(document.owner).toBe("rnet://id/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47");
    expect(document.source.ingest).toEqual({ method: "authored", reproducible: false });
    expect(document.source.origins).toEqual(["rnet://client/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b48"]);
    const mediaElementUri = document.elements[0];
    expect(mediaElementUri).toMatch(/^rnet:\/\/element\/[0-9a-f-]{36}$/);
    const mediaElementRead = await request(
      `/rnet/v0/elements/${mediaElementUri.split("/").at(-1)}`,
      { headers: dmachine },
    );
    expect(mediaElementRead.status).toBe(200);
    const mediaElement = await mediaElementRead.json();
    expect(mediaElement.owner).toBe(document.owner);
    expect(mediaElement.content_hash).toMatch(/^sha256:[a-f0-9]{64}$/);

    const inferred = await request(`/rnet/v0/objects/${mediaObjectId}/inferred`, {
      method: "PUT",
      headers: dmachine,
      json: { task: "forecast", entry: { model: "test/model", properties: { next: 42 } } },
    });
    expect(inferred.status).toBe(200);
    expect((await inferred.json()).inferred["rbudget:forecast"].properties.next).toBe(42);

    const spoof = await request(`/rnet/v0/objects/${mediaObjectId}/inferred`, {
      method: "PUT",
      headers: dmachine,
      json: { task: "rhizome:forecast", entry: { model: "test/model", properties: {} } },
    });
    expect(spoof.status).toBe(422);

    const durableTask = await request(`/rnet/v0/objects/${mediaObjectId}/inferred`, {
      method: "PUT",
      headers: dmachine,
      json: {
        task: "forecast",
        entry: { model: "test/model", durable: true, properties: {} },
      },
    });
    expect(durableTask.status).toBe(422);

    const userInference = await request(`/rnet/v0/objects/${mediaObjectId}/inferred`, {
      method: "PUT",
      headers: owner,
      json: {
        task: "correction",
        entry: { model: "user/direct", durable: true, properties: { category: "coffee" } },
      },
    });
    expect(userInference.status).toBe(200);
    expect(
      (await userInference.json()).inferred["user/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47:correction"]
        .properties.category,
    ).toBe("coffee");
  });

  test("creates a shared upload once across batched media objects", async () => {
    const response = await request("/rnet/v0/objects", {
      method: "POST",
      headers: dmachine,
      json: {
        vibe: `rnet://vibe/${vibeId}`,
        objects: [
          {
            type: "note",
            elements: [{ upload: "shared", kind: "text", mime: "text/plain" }],
            properties: { title: "First reference" },
          },
          {
            type: "note",
            elements: [{ upload: "shared", kind: "text", mime: "text/plain" }],
            properties: { title: "Second reference" },
          },
        ],
      },
      uploads: { shared: { bytes: "Shared element", mime: "text/plain" } },
    });

    expect(response.status).toBe(201);
    const mediaObjects = (await response.json()).mediaObjects;
    expect(mediaObjects).toHaveLength(2);
    expect(mediaObjects[0].elements[0]).toBe(mediaObjects[1].elements[0]);
    const mediaElementUuid = mediaObjects[0].elements[0].split("/").at(-1);
    const [stored] = await client.unsafe(
      "select count(*)::int as elements from media_elements where uuid = $1",
      [mediaElementUuid],
    );
    expect(stored?.elements).toBe(1);
  });

  test("does not treat same-owner record identifiers as dMachine capabilities", async () => {
    const privateVibeResponse = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: { title: "Private" },
    });
    const privateVibe = await privateVibeResponse.json();
    const privateObjectResponse = await request("/rnet/v0/objects", {
      method: "POST",
      headers: owner,
      json: {
        vibe: privateVibe.uri,
        objects: [
          {
            type: "note",
            elements: [],
            source: {
              ingest: { method: "parser", reproducible: true },
              origins: [originUri],
              properties: { title: "Private note" },
            },
          },
        ],
      },
    });
    const privateObject = (await privateObjectResponse.json()).mediaObjects[0];
    const attachKnownObject = await request(`/rnet/v0/vibes/${vibeId}/objects`, {
      method: "POST",
      headers: dmachine,
      json: { objects: [privateObject.uri] },
    });
    expect(attachKnownObject.status).toBe(403);

    const privateElementResponse = await app.request("http://rhizome.test/rnet/v0/elements", {
      method: "POST",
      headers: { ...owner, "Content-Type": "text/plain", "X-Rnet-Kind": "text" },
      body: "Owner-private payload",
    });
    const privateElement = await privateElementResponse.json();
    const attachKnownElement = await request("/rnet/v0/objects", {
      method: "POST",
      headers: dmachine,
      json: {
        vibe: `rnet://vibe/${vibeId}`,
        objects: [{ type: "note", elements: [privateElement.uri], properties: {} }],
      },
    });
    expect(attachKnownElement.status).toBe(403);
  });

  test("owner tombstones preserve object references while metadata and bytes disappear", async () => {
    const originResponse = await app.request("http://rhizome.test/rnet/v0/origins", {
      method: "POST",
      headers: { ...owner, "Content-Type": "text/plain" },
      body: "Disposable origin",
    });
    expect(originResponse.status).toBe(201);
    const disposableOrigin = await originResponse.json();

    const elementResponse = await app.request("http://rhizome.test/rnet/v0/elements", {
      method: "POST",
      headers: { ...owner, "Content-Type": "text/plain", "X-Rnet-Kind": "text" },
      body: "Disposable element",
    });
    expect(elementResponse.status).toBe(201);
    const disposableElement = await elementResponse.json();

    expect(disposableOrigin.bytes).toBe(
      `http://rhizome.test/rnet/v0/origins/${disposableOrigin.uri.split("/").at(-1)}/bytes`,
    );
    expect(disposableElement.bytes).toBe(
      `http://rhizome.test/rnet/v0/elements/${disposableElement.uri.split("/").at(-1)}/bytes`,
    );
    const originBytes = await app.request(disposableOrigin.bytes, { headers: owner });
    const elementBytes = await app.request(disposableElement.bytes, { headers: owner });
    expect(originBytes.status).toBe(200);
    expect(originBytes.headers.get("Content-Type")).toBe("text/plain");
    expect(elementBytes.status).toBe(200);
    expect(elementBytes.headers.get("Content-Type")).toBe("text/plain");

    const mediaObjectResponse = await request("/rnet/v0/objects", {
      method: "POST",
      headers: owner,
      json: {
        objects: [
          {
            type: "note",
            elements: [disposableElement.uri],
            source: {
              ingest: { method: "parser", reproducible: true },
              origins: [disposableOrigin.uri],
              properties: {},
            },
          },
        ],
      },
    });
    expect(mediaObjectResponse.status).toBe(201);
    const mediaObject = (await mediaObjectResponse.json()).mediaObjects[0];
    const elementId = disposableElement.uri.split("/").at(-1);
    const originId = disposableOrigin.uri.split("/").at(-1);

    expect(
      (await request(`/rnet/v0/elements/${elementId}`, { method: "DELETE", headers: otherOwner }))
        .status,
    ).toBe(403);
    expect(
      (await request(`/rnet/v0/origins/${originId}`, { method: "DELETE", headers: otherOwner }))
        .status,
    ).toBe(403);
    expect(
      (await request(`/rnet/v0/elements/${elementId}`, { method: "DELETE", headers: owner }))
        .status,
    ).toBe(204);
    expect(
      (await request(`/rnet/v0/origins/${originId}`, { method: "DELETE", headers: owner })).status,
    ).toBe(204);

    expect((await request(`/rnet/v0/elements/${elementId}`, { headers: owner })).status).toBe(404);
    expect((await request(`/rnet/v0/elements/${elementId}/bytes`, { headers: owner })).status).toBe(
      404,
    );
    expect((await request(`/rnet/v0/origins/${originId}`, { headers: owner })).status).toBe(404);
    expect((await request(`/rnet/v0/origins/${originId}/bytes`, { headers: owner })).status).toBe(
      404,
    );

    const preservedObject = await request(`/rnet/v0/objects/${mediaObject.uri.split("/").at(-1)}`, {
      headers: owner,
    });
    expect(preservedObject.status).toBe(200);
    const preservedDocument = await preservedObject.json();
    expect(preservedDocument.elements).toEqual([disposableElement.uri]);
    expect(preservedDocument.source.origins).toEqual([disposableOrigin.uri]);
  });

  test("deletes a Vibe without deleting dMachine-created records", async () => {
    const disposableVibeResponse = await request("/rnet/v0/vibes", {
      method: "POST",
      headers: owner,
      json: {
        title: "Disposable",
        grants: [{ subject: "client:rbudget", scope: ["read", "write:objects"] }],
      },
    });
    const disposableVibe = await disposableVibeResponse.json();
    const disposableVibeId = disposableVibe.uri.split("/").at(-1);

    const mediaObjectResponse = await request("/rnet/v0/objects", {
      method: "POST",
      headers: dmachine,
      json: {
        vibe: disposableVibe.uri,
        objects: [
          {
            type: "note",
            elements: [{ upload: "retained", kind: "text", mime: "text/plain" }],
            properties: { title: "Retained" },
          },
        ],
      },
      uploads: {
        retained: { bytes: "Retained after Vibe deletion", mime: "text/plain" },
      },
    });
    expect(mediaObjectResponse.status).toBe(201);
    const mediaObject = (await mediaObjectResponse.json()).mediaObjects[0];
    const retainedMediaElementUuid = mediaObject.elements[0].split("/").at(-1);
    const retainedMediaObjectUuid = mediaObject.uri.split("/").at(-1);

    expect(
      (await request(`/rnet/v0/vibes/${disposableVibeId}`, { method: "DELETE", headers: owner }))
        .status,
    ).toBe(204);
    const retained = await client.unsafe(
      `select
         exists(select 1 from media_elements where uuid = $1) as element_exists,
         exists(select 1 from media_objects where uuid = $2) as object_exists`,
      [retainedMediaElementUuid, retainedMediaObjectUuid],
    );
    expect(retained[0]?.element_exists).toBe(true);
    expect(retained[0]?.object_exists).toBe(true);
  });

  test("revocation fails closed on the next request", async () => {
    const patched = await request(`/rnet/v0/vibes/${vibeId}`, {
      method: "PATCH",
      headers: owner,
      json: { grants: [] },
    });
    expect(patched.status).toBe(200);
    expect((await request(`/rnet/v0/vibes/${vibeId}`, { headers: dmachine })).status).toBe(403);
    const audit = await client.unsafe(
      `select revoked_at is not null as revoked from grants where vibe_uuid = $1 and subject = 'client:rbudget'`,
      [vibeId],
    );
    expect(audit[0]?.revoked).toBe(true);
  });
});

async function request(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    json?: unknown;
    uploads?: Record<string, { bytes: string | Uint8Array; mime: string }>;
  } = {},
): Promise<Response> {
  if (path === "/rnet/v0/objects" && options.json !== undefined) {
    const form = new FormData();
    form.set("metadata", JSON.stringify(options.json));
    for (const [name, upload] of Object.entries(options.uploads ?? {})) {
      const bytes =
        typeof upload.bytes === "string"
          ? upload.bytes
          : (upload.bytes.slice().buffer as ArrayBuffer);
      form.set(name, new Blob([bytes], { type: upload.mime }), name);
    }
    return app.request(`http://rhizome.test${path}`, {
      method: options.method,
      headers: options.headers,
      body: form,
    });
  }
  const headers = {
    ...(options.json === undefined ? {} : { "Content-Type": "application/json" }),
    ...options.headers,
  };
  return app.request(`http://rhizome.test${path}`, {
    method: options.method,
    headers,
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
  });
}

async function waitForOperation(
  initial: OperationDocument,
  headers: Record<string, string>,
): Promise<OperationDocument> {
  let operation = initial;
  for (
    let attempt = 0;
    attempt < 100 && ["queued", "running"].includes(operation.status);
    attempt += 1
  ) {
    await Bun.sleep(10);
    const response = await request(`/rnet/v0/operations/${operation.operation_id}`, { headers });
    expect(response.status).toBe(200);
    operation = (await response.json()) as OperationDocument;
  }
  return operation;
}

async function createCsvSourceFixture(label: string): Promise<{
  origin: { uri: string };
  source: { source: string };
}> {
  const bytes = await Bun.file(
    new URL("../../ingest/skills/csv/fixtures/rhizome-bank.csv", import.meta.url),
  ).text();
  const originResponse = await app.request("http://rhizome.test/rnet/v0/origins", {
    method: "POST",
    headers: { ...owner, "Content-Type": "text/csv", "X-Rnet-Label": label },
    body: bytes,
  });
  expect(originResponse.status).toBe(201);
  const origin = (await originResponse.json()) as { uri: string };
  const sourceResponse = await request("/rnet/v0/ingestion-sources", {
    method: "POST",
    headers: owner,
    json: { origin: origin.uri, skill_id: "csv" },
  });
  expect(sourceResponse.status).toBe(201);
  return {
    origin,
    source: (await sourceResponse.json()) as { source: string },
  };
}

async function createStoredSimpleFinCredential(sourceCount: number): Promise<{
  credentialUuid: string;
  sources: IngestionSourceDocument[];
}> {
  const credentialUuid = uuidv7();
  await db.insert(sourceCredentials).values({
    uuid: credentialUuid,
    userUuid: DEV_USER_UUID,
    skillId: SIMPLEFIN_SKILL_ID,
    connectorVersion: SIMPLEFIN_CONNECTOR_VERSION,
    secret: await sealCredentialSecret(
      simpleFinAccessUrl,
      credentialEncryptionKeys,
      credentialAssociatedData(credentialUuid, DEV_USER_UUID, SIMPLEFIN_SKILL_ID),
    ),
  });
  const sources: IngestionSourceDocument[] = [];
  for (let index = 0; index < sourceCount; index += 1) {
    const response = await request("/rnet/v0/ingestion-sources", {
      method: "POST",
      headers: owner,
      json: {
        credential: `credential:${credentialUuid}`,
        config: {
          accounts: [{ connection_id: "conn-alpha", account_id: "acct-shared" }],
          include_pending: index % 2 === 0,
        },
      },
    });
    expect(response.status).toBe(201);
    sources.push((await response.json()) as IngestionSourceDocument);
  }
  return { credentialUuid, sources };
}

async function mediaObjectCount(): Promise<number> {
  const [row] = await client.unsafe("select count(*)::int as count from media_objects");
  return row?.count ?? 0;
}

async function sourceBindingCount(source: string): Promise<number> {
  const [row] = await client.unsafe(
    "select count(*)::int as count from ingestion_source_objects where source_uuid = $1",
    [sourceUuid(source)],
  );
  return row?.count ?? 0;
}

function sourceUuid(source: string): string {
  return source.slice("source:".length);
}

async function connectedFetches(
  sourceUuid: string,
  status: "fetching" | "fetched" | "verified" | "rejected" | "committed",
) {
  return db
    .select()
    .from(ingestionSourceFetches)
    .where(
      and(
        eq(ingestionSourceFetches.sourceUuid, sourceUuid),
        eq(ingestionSourceFetches.status, status),
      ),
    )
    .orderBy(asc(ingestionSourceFetches.createdAt));
}

async function simpleFinFixtureBytes(name: string): Promise<Uint8Array> {
  return new Uint8Array(
    await Bun.file(
      new URL(`../../ingest/skills/simplefin/fixtures/${name}`, import.meta.url),
    ).arrayBuffer(),
  );
}

function simpleFinAccountSetBytes(input: {
  balance: string;
  balanceAtEpoch: number;
  transactions?: Array<{
    id: string;
    posted: number;
    amount: string;
    description: string;
  }>;
}): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      errlist: [],
      connections: [
        {
          conn_id: "conn-alpha",
          name: "Synthetic Community Bank",
          org_id: "org-alpha",
          sfin_url: "https://synthetic-a.example.invalid/simplefin",
        },
      ],
      accounts: [
        {
          id: "acct-shared",
          name: "Synthetic Checking",
          conn_id: "conn-alpha",
          currency: "USD",
          balance: input.balance,
          "balance-date": input.balanceAtEpoch,
          transactions: input.transactions ?? [],
        },
      ],
    }),
  );
}
