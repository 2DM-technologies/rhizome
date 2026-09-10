import type { Page, Request, Route } from "@playwright/test";
import type { MediaElement, MediaObject, OriginArtifact, Vibe } from "@rnet/types";
import type {
  CreateImportPreviewRequest,
  IngestionSourceDocument,
  OperationDocument,
  SourceActionRequired,
  SourceConnectionAttemptDocument,
  SourceConnectionIntent,
  SourceCredentialDocument,
  SourceSkillManifest,
  StartSourceConnectionRequest,
  PushVibeRequest,
} from "@rhizome/store-contract";
import { storeTaskKey } from "@rhizome/store-contract";
import { PUSH_TASKS } from "../../src/api/generated/push-tasks.ts";

export const OWNER_ID = "0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47";
export const VIBE_ID = "0198f2a1-a09b-76aa-95d8-fc5b55b41fd2";
export const NEW_VIBE_ID = "0198f2a1-d3be-79dd-88ab-2f8e88e74cf5";
export const OBJECT_ID = "0198f2a1-b19c-77bb-a6e9-0d6c66c52ae3";
export const ELEMENT_ID = "0198f2a1-c2ad-78cc-b7fa-1e7d77d63bf4";
export const PULL_OPERATION_ID = "0198f2a1-e4cf-7add-99bc-3a9f99f85df6";
export const SOURCE_ID = "0198f2a1-f5d0-7bee-aacd-4ba0aa096e07";

export const VIBE_URI = `rnet://vibe/${VIBE_ID}` as const;
export const OBJECT_URI = `rnet://object/${OBJECT_ID}` as const;
export const ELEMENT_URI = `rnet://element/${ELEMENT_ID}` as const;
export const PAYLOAD_TEXT = "A “seeded” payload 🤔 for browser tests.\n";

const fixtureVibe = {
  rnet_schema: "0.1",
  uri: VIBE_URI,
  owner: `rnet://id/${OWNER_ID}`,
  title: "Spending",
  objects: [OBJECT_URI],
  created_at: "2026-08-27T12:00:00.000Z",
  grants: [],
  inferred: {},
  pull: {
    enabled: true,
    sources: [`source:${SOURCE_ID}`],
    policy: "append_new",
  },
} satisfies Vibe;

const fixtureObject = {
  rnet_schema: "0.1",
  uri: OBJECT_URI,
  owner: `rnet://id/${OWNER_ID}`,
  type: "note",
  elements: [{ uri: ELEMENT_URI, role: "content" }],
  source: {
    ingest: { method: "authored", reproducible: false },
    origins: ["rnet://client/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b48"],
    properties: { title: "Monthly plan" },
  },
  user: { properties: { reviewed: false }, updated_at: "2026-08-27T12:00:00.000Z" },
} satisfies MediaObject;

const fixtureElement = {
  rnet_schema: "0.1",
  kind: "text",
  uri: ELEMENT_URI,
  owner: `rnet://id/${OWNER_ID}`,
  content_hash: "sha256:ddc08041941729fa9a0bdc8703756e531b8b187e3af3bc7455a424c7691d62db",
  mime: "text/plain",
  bytes: `http://127.0.0.1/rnet/v0/elements/${ELEMENT_ID}/bytes`,
  byte_size: Buffer.byteLength(PAYLOAD_TEXT),
  alt: "Monthly plan",
  created_at: "2026-08-27T12:00:00.000Z",
} satisfies MediaElement;

export interface MockOriginUpload {
  byteLength: number;
  document: OriginArtifact;
  payload: Buffer;
}

interface MockImportOperation {
  candidates: MediaObject[];
  document: OperationDocument;
  elements: MockStagedElement[];
  polls: number;
  source: string;
  verify: MockImportVerification;
  destination?: { title: string };
  pendingVibe?: boolean;
}

interface MockPushOperation {
  document: OperationDocument;
  input: PushVibeRequest;
  polls: number;
  applied: boolean;
  vibeId: string;
}

function applyPush(operation: MockPushOperation, store: MockStore) {
  if (operation.applied) return;
  operation.applied = true;
  const vibe = store.vibes.find((candidate) => candidate.uri.endsWith(`/${operation.vibeId}`));
  if (!vibe) return;
  const key = storeTaskKey(operation.input.task);
  const envelope = (taskProperties: Record<string, unknown>) => ({
    model: "mock/rhizome",
    inferred_at: "2026-08-27T12:04:00.050Z",
    properties: taskProperties,
  });
  const shared = {
    task: operation.input.task,
    model: "mock/rhizome",
    llm_calls: 1,
    context: { truncated_objects: 0, truncated_pointers: 0, clipped_objects: 0 },
    abort_reason: null,
    usage: {
      tokens_in: 10,
      cached_tokens_in: 0,
      tokens_out: 5,
      usd: "0.000004",
      served_tiers: ["flex"],
      tier_assumed: false,
    },
  } as const;
  if (operation.input.level === "vibe") {
    const taskProperties =
      operation.input.task === PUSH_TASKS.vibe.summarize.name
        ? {
            summary: "A focused collection of monthly planning notes.",
            tags: ["planning"],
            confidence: 0.9,
          }
        : { view: "simplelist", config: { subtitle_pointer: "/source/properties/title" } };
    vibe.inferred = { ...(vibe.inferred ?? {}), [key]: envelope(taskProperties) };
    operation.document.result = {
      ...shared,
      level: "vibe",
      vibe: { outcome: "written", key, rev: 1 },
    };
    return;
  }
  const selected = [...new Set(operation.input.selection ?? vibe.objects)];
  const written = selected.map((uri) => ({ uri, key, rev: 1 }));
  for (const uri of selected) {
    const id = uri.split("/").at(-1) ?? "";
    const object = store.objects.get(id);
    if (!object) continue;
    const taskProperties =
      operation.input.task === PUSH_TASKS.object.display_name.name
        ? { display_name: "Enriched monthly plan" }
        : { keywords: ["monthly", "planning"] };
    store.objects.set(id, {
      ...object,
      inferred: { ...(object.inferred ?? {}), [key]: envelope(taskProperties) },
    });
  }
  operation.document.result = {
    ...shared,
    level: "object",
    objects: {
      selected: selected.length,
      sent: selected.length,
      written: written.length,
      removed: 0,
      preserved_durable: 0,
      skipped: 0,
      failed: 0,
    },
    written,
    preserved: [],
    skipped: [],
  };
}

export interface MockImportVerification {
  ok: boolean;
  source_record_count: number;
  candidate_count: number;
  totals_by_currency: Record<string, string>;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  readonly [key: string]: unknown;
}

export interface MockStagedElement {
  document: MediaElement;
  object_uri: string;
  preview_url: string;
  role: "title" | "content" | "preview";
  alt?: string;
  payload: Buffer;
}

export interface MockStagedImport {
  candidates: MediaObject[];
  elements?: MockStagedElement[];
  verification: MockImportVerification;
  destination?: { title: string };
}

export interface MockSourceActionDefinition {
  detail: string;
  operationError: string;
  title: string;
}

export interface MockSourceCaptureContext {
  nextSequence(skillId: string): number;
  save(input: {
    contentHash: string;
    id: string;
    label: string;
    mime: string;
    payload: string | Uint8Array;
  }): OriginArtifact;
}

export interface MockSourceSkillAdapter {
  readonly credentialId?: string;
  readonly manifest: SourceSkillManifest;
  readonly operationId: string;
  readonly originUpload?: {
    readonly contentHash: string;
    readonly id: string;
    accepts(input: { label: string; mime: string }): boolean;
  };
  readonly oauth?: {
    readonly authorizationEndpoint: string;
    readonly authorizationCode: string;
  };
  readonly sourceAction?: MockSourceActionDefinition;
  readonly sourceId: string;
  capture?(context: MockSourceCaptureContext): OriginArtifact | Promise<OriginArtifact>;
  connect?(
    input: unknown,
  ):
    | { ok: true; publicMetadata?: JsonObject }
    | { ok: false; detail: string }
    | Promise<{ ok: true; publicMetadata?: JsonObject } | { ok: false; detail: string }>;
  normalizeConfig?(input: unknown): { ok: true; value: JsonObject } | { ok: false; detail: string };
  stage(input: {
    actionResumed: boolean;
    origin: MockOriginUpload;
  }): MockStagedImport | Promise<MockStagedImport>;
}

export interface MockSourceActionRequest {
  /** `null` models the delegated/redacted ownership boundary. */
  readonly source: string | null;
  readonly skillId: string;
  readonly timing: "pull_problem" | "polled_operation";
}

export interface MockStoreOptions {
  readonly sourceSkills?: readonly MockSourceSkillAdapter[];
}

export interface CredentialedSkillMockConformanceCase {
  readonly adapter: MockSourceSkillAdapter;
  readonly config?: unknown;
  readonly invalidConnectionInput: unknown;
  readonly validConnectionInput: unknown;
}

type JsonObject = Record<string, unknown>;

/**
 * Exercises the behavior every credentialed mock must provide, including rejected and accepted
 * connection inputs, normalized source config, raw capture persistence, and staged VERIFY output.
 */
export async function runCredentialedSkillMockConformance({
  adapter,
  config,
  invalidConnectionInput,
  validConnectionInput,
}: CredentialedSkillMockConformanceCase): Promise<void> {
  if (
    adapter.manifest.source_kind !== "credentialed_remote" ||
    !adapter.manifest.connection ||
    !adapter.credentialId ||
    !adapter.connect ||
    !adapter.capture ||
    !adapter.normalizeConfig
  ) {
    throw new Error("Credentialed mock is missing its declared lifecycle capabilities");
  }
  const rejected = await adapter.connect(invalidConnectionInput);
  if (rejected.ok || !rejected.detail) {
    throw new Error(`${adapter.manifest.skill_id} accepted the invalid conformance credential`);
  }
  const connected = await adapter.connect(validConnectionInput);
  if (!connected.ok) {
    throw new Error(`${adapter.manifest.skill_id} rejected the valid conformance credential`);
  }
  const normalized = adapter.normalizeConfig(config);
  if (!normalized.ok) {
    throw new Error(`${adapter.manifest.skill_id} rejected the conformance source config`);
  }

  const uploads = new Map<string, MockOriginUpload>();
  let sequence = 0;
  const context: MockSourceCaptureContext = {
    nextSequence() {
      sequence += 1;
      return sequence;
    },
    save({ contentHash, id, label, mime, payload }) {
      const bytes = typeof payload === "string" ? Buffer.from(payload) : Buffer.from(payload);
      const document = mockOriginDocument({
        contentHash,
        id,
        label,
        mime,
        byteLength: bytes.byteLength,
      });
      uploads.set(id, { byteLength: bytes.byteLength, document, payload: bytes });
      return document;
    },
  };
  const captured = await adapter.capture(context);
  const upload = uploads.get(captured.uri.split("/").at(-1) ?? "");
  if (!upload || upload.byteLength === 0) {
    throw new Error(`${adapter.manifest.skill_id} did not persist its conformance capture`);
  }
  const staged = await adapter.stage({ actionResumed: false, origin: upload });
  if (
    staged.verification.candidate_count !== staged.candidates.length ||
    staged.verification.checks.length === 0
  ) {
    throw new Error(`${adapter.manifest.skill_id} produced inconsistent conformance VERIFY output`);
  }
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface MockStore {
  readonly requests: Request[];
  readonly vibes: Vibe[];
  readonly objects: Map<string, MediaObject>;
  readonly elements: Map<string, MediaElement>;
  readonly elementPayloads: Map<string, Buffer<ArrayBufferLike>>;
  readonly origins: Map<string, MockOriginUpload>;
  readonly ingestionSources: Map<string, IngestionSourceDocument>;
  readonly sourceCredentials: Map<string, SourceCredentialDocument>;
  readonly sourceConnectionAttempts: Map<string, SourceConnectionAttemptDocument>;
  /** Hold exactly the next ingestion-source creation until the returned release is called. */
  holdNextIngestionSourceCreation: () => () => void;
  /** Hold exactly the next user-property write until the returned release function is called. */
  holdNextUserWrite: () => () => void;
  /** Make exactly the next refresh require a registered skill's owner review action. */
  requireNextSourceAction: (request: MockSourceActionRequest) => void;
  /** Make exactly the next generic OAuth provider visit return a provider denial. */
  rejectNextOAuthConnection: (errorCode?: string) => void;
}

interface MockOAuthAttempt {
  readonly adapter: MockSourceSkillAdapter;
  readonly bindingCookie: string;
  readonly bindingCookieName: string;
  readonly callbackUrl: string;
  readonly returnUrl: string;
  readonly state: string;
  readonly intent: SourceConnectionIntent;
  document: SourceConnectionAttemptDocument;
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function problem(
  route: Route,
  status: number,
  code: string,
  detail: string,
  extensions: Record<string, unknown> = {},
) {
  return route.fulfill({
    status,
    contentType: "application/problem+json",
    body: JSON.stringify({
      type: `https://rhizome.tools/problems/${code.replaceAll("_", "-")}`,
      title: status === 404 ? "Not found" : "Invalid request",
      status,
      detail,
      code,
      ...extensions,
    }),
  });
}

function noContent(route: Route) {
  return route.fulfill({ status: 204 });
}

function mockOriginDocument({
  byteLength,
  contentHash,
  id,
  label,
  mime,
}: {
  byteLength: number;
  contentHash: string;
  id: string;
  label: string;
  mime: string;
}): OriginArtifact {
  return {
    rnet_schema: "0.1",
    uri: `rnet://origin/${id}`,
    owner: `rnet://id/${OWNER_ID}`,
    content_hash: contentHash,
    mime,
    bytes: `http://127.0.0.1/rnet/v0/origins/${id}/bytes`,
    byte_size: byteLength,
    label,
    uploaded_at: "2026-08-28T12:00:01.000Z",
  } satisfies OriginArtifact;
}

/**
 * A stateful Store boundary for browser tests that exercise the real generated client and Query
 * integration without sharing Postgres or object-storage state with the server suites.
 */
export async function installMockStore(
  page: Page,
  { sourceSkills = [] }: MockStoreOptions = {},
): Promise<MockStore> {
  const installedSourceSkillAdapters = [...sourceSkills];
  const installedSourceSkillsById = new Map(
    installedSourceSkillAdapters.map((adapter) => [adapter.manifest.skill_id, adapter]),
  );
  if (installedSourceSkillsById.size !== installedSourceSkillAdapters.length) {
    throw new Error("Mock source-skill registrations must have unique skill IDs");
  }
  const oauthAdapters = installedSourceSkillAdapters.filter(
    (adapter) => adapter.manifest.connection?.mode === "oauth2_pkce",
  );
  for (const adapter of installedSourceSkillAdapters) {
    const declaresOAuth = adapter.manifest.connection?.mode === "oauth2_pkce";
    if (declaresOAuth !== Boolean(adapter.oauth)) {
      throw new Error(
        `Mock source skill ${adapter.manifest.skill_id} must keep its OAuth manifest and provider adapter in sync`,
      );
    }
    if (adapter.oauth && !adapter.credentialId) {
      throw new Error(`Mock OAuth source skill ${adapter.manifest.skill_id} needs a credential ID`);
    }
    if (adapter.oauth && new URL(adapter.oauth.authorizationEndpoint).protocol !== "https:") {
      throw new Error(
        `Mock OAuth source skill ${adapter.manifest.skill_id} needs an HTTPS provider`,
      );
    }
  }
  if (
    new Set(oauthAdapters.map((adapter) => adapter.oauth?.authorizationEndpoint)).size !==
    oauthAdapters.length
  ) {
    throw new Error("Mock OAuth providers must use unique authorization endpoints");
  }
  let pendingIngestionSourceCreation: Promise<void> | null = null;
  let pendingUserWrite: Promise<void> | null = null;
  let pullOperation: Record<string, unknown> | undefined;
  let pushSequence = 0;
  const pushOperations = new Map<string, MockPushOperation>();
  let nextSourceAction: MockSourceActionRequest | undefined;
  let pendingPullFailureResult: Record<string, unknown> | undefined;
  let pendingPullFailureError: string | undefined;
  let nextOAuthRejection: string | undefined;
  let sourceConnectionSequence = 0;
  let continuationSequence = 0;
  const importOperations = new Map<string, MockImportOperation>();
  const oauthAttemptsByState = new Map<string, MockOAuthAttempt>();
  const oauthAttemptsById = new Map<string, MockOAuthAttempt>();
  const sourceCredentialBindings = new Map<string, string>();
  const captureSequences = new Map<string, number>();
  const continuations = new Map<
    string,
    { readonly skillId: string; readonly source: string; readonly vibeId: string }
  >();
  const elementPayloads = new Map<string, Buffer<ArrayBufferLike>>([
    [ELEMENT_ID, Buffer.from(PAYLOAD_TEXT)],
  ]);
  const store: MockStore = {
    requests: [],
    vibes: [structuredClone(fixtureVibe)],
    objects: new Map([[OBJECT_ID, structuredClone(fixtureObject)]]),
    elements: new Map([[ELEMENT_ID, structuredClone(fixtureElement)]]),
    elementPayloads,
    origins: new Map(),
    ingestionSources: new Map(),
    sourceCredentials: new Map(),
    sourceConnectionAttempts: new Map(),
    holdNextIngestionSourceCreation: () => {
      if (pendingIngestionSourceCreation) {
        throw new Error("An ingestion-source creation is already held");
      }
      let release!: () => void;
      pendingIngestionSourceCreation = new Promise((resolve) => {
        release = resolve;
      });
      return release;
    },
    holdNextUserWrite: () => {
      if (pendingUserWrite) throw new Error("A user-property write is already held");
      let release!: () => void;
      pendingUserWrite = new Promise((resolve) => {
        release = resolve;
      });
      return release;
    },
    requireNextSourceAction: (request) => {
      const adapter = installedSourceSkillsById.get(request.skillId);
      if (!adapter?.sourceAction) {
        throw new Error(`Mock source skill ${request.skillId} has no review action`);
      }
      if (nextSourceAction) throw new Error("A mock source action is already queued");
      nextSourceAction = request;
    },
    rejectNextOAuthConnection: (errorCode = "access_denied") => {
      if (nextOAuthRejection) throw new Error("A mock OAuth rejection is already queued");
      nextOAuthRejection = errorCode;
    },
  };

  const captureContext: MockSourceCaptureContext = {
    nextSequence(skillId) {
      const sequence = (captureSequences.get(skillId) ?? 0) + 1;
      captureSequences.set(skillId, sequence);
      return sequence;
    },
    save({ contentHash, id, label, mime, payload }) {
      const bytes = typeof payload === "string" ? Buffer.from(payload) : Buffer.from(payload);
      const document = mockOriginDocument({
        byteLength: bytes.byteLength,
        contentHash,
        id,
        label,
        mime,
      });
      store.origins.set(id, { byteLength: bytes.byteLength, document, payload: bytes });
      return document;
    },
  };

  function actionExtensions(
    request: MockSourceActionRequest,
    vibeId: string,
  ): Record<string, unknown> {
    const adapter = installedSourceSkillsById.get(request.skillId);
    if (!adapter?.sourceAction) throw new Error(`Missing action for ${request.skillId}`);
    if (!request.source) return { owner_action_required: true, action: "review_import" };

    continuationSequence += 1;
    const continuationToken = `mock-continuation-${String(continuationSequence).padStart(4, "0")}-${"x".repeat(32)}`;
    continuations.set(continuationToken, {
      skillId: request.skillId,
      source: request.source,
      vibeId,
    });
    const requiredAction = {
      kind: "source_action_required",
      action: "review_import",
      title: adapter.sourceAction.title,
      detail: adapter.sourceAction.detail,
      source: request.source,
      continuation_token: continuationToken,
    } satisfies SourceActionRequired;
    return { required_action: requiredAction };
  }

  for (const adapter of oauthAdapters) {
    const oauth = adapter.oauth!;
    await page.route(`${oauth.authorizationEndpoint}**`, async (route) => {
      const request = route.request();
      store.requests.push(request);
      const authorization = new URL(request.url());
      const state = authorization.searchParams.get("state") ?? "";
      const attempt = oauthAttemptsByState.get(state);
      if (
        !attempt ||
        attempt.adapter !== adapter ||
        authorization.searchParams.get("response_type") !== "code" ||
        authorization.searchParams.get("code_challenge_method") !== "S256" ||
        !authorization.searchParams.get("code_challenge") ||
        authorization.searchParams.get("redirect_uri") !== attempt.callbackUrl
      ) {
        return problem(route, 422, "invalid_authorization_request", "Invalid mock OAuth request");
      }

      const callback = new URL(attempt.callbackUrl);
      callback.searchParams.set("state", state);
      if (nextOAuthRejection) {
        callback.searchParams.set("error", nextOAuthRejection);
        callback.searchParams.set("error_description", "The owner declined the provider request");
        nextOAuthRejection = undefined;
      } else {
        callback.searchParams.set("code", oauth.authorizationCode);
      }
      // Start a fresh browser navigation so Playwright applies the Store callback route too. A
      // redirect fulfilled from an intercepted provider request otherwise bypasses interception
      // for the redirect chain and falls through to Vite's SPA fallback.
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><title>Mock OAuth provider</title><script>window.location.replace(${JSON.stringify(callback.href)})</script>`,
      });
    });
  }

  await page.route("**/rnet/v0/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    store.requests.push(request);

    if (method === "GET" && path === "/rnet/v0/vibes") {
      return json(route, { vibes: store.vibes });
    }

    if (method === "POST" && path === "/rnet/v0/vibes") {
      const input = request.postDataJSON() as { title: string };
      const vibe = {
        rnet_schema: "0.1",
        uri: `rnet://vibe/${NEW_VIBE_ID}`,
        owner: `rnet://id/${OWNER_ID}`,
        title: input.title,
        objects: [],
        created_at: "2026-08-27T12:02:00.000Z",
        grants: [],
        inferred: {},
      } satisfies Vibe;
      store.vibes.push(vibe);
      return json(route, vibe, 201);
    }

    if (method === "GET" && path === "/rnet/v0/source-skills") {
      return json(route, {
        skills: installedSourceSkillAdapters.map((adapter) => adapter.manifest),
      });
    }

    if (method === "GET" && path === "/rnet/v0/push-tasks") {
      return json(route, {
        tasks: [...Object.values(PUSH_TASKS.vibe), ...Object.values(PUSH_TASKS.object)],
      });
    }

    const oauthStartPath = path.match(/^\/rnet\/v0\/source-connections\/([^/]+)\/oauth$/);
    if (method === "POST" && oauthStartPath) {
      const skillId = decodeURIComponent(oauthStartPath[1] ?? "");
      const adapter = installedSourceSkillsById.get(skillId);
      if (
        !adapter?.oauth ||
        !adapter.credentialId ||
        adapter.manifest.connection?.mode !== "oauth2_pkce"
      ) {
        return problem(route, 404, "not_found", "The OAuth source skill does not exist");
      }
      const rawInput: unknown = request.postDataJSON();
      if (!isRecord(rawInput) || typeof rawInput.return_to !== "string") {
        return problem(route, 422, "schema_violation", "The connection request is invalid");
      }
      const input = rawInput as StartSourceConnectionRequest;
      const returnUrl = new URL(input.return_to);
      const destination = input.intent?.destination;
      const existingVibeId =
        destination?.kind === "existing_vibe" ? destination.id.split("/").at(-1) : undefined;
      const expectedPath =
        destination?.kind === "new_vibe"
          ? "/imports"
          : existingVibeId
            ? `/vibes/${existingVibeId}`
            : undefined;
      if (
        input.intent?.kind !== "review_import" ||
        !expectedPath ||
        returnUrl.origin !== url.origin ||
        returnUrl.pathname.replace(/\/$/u, "") !== expectedPath ||
        returnUrl.search ||
        returnUrl.hash
      ) {
        return problem(route, 422, "schema_violation", "The connection return target is invalid");
      }

      sourceConnectionSequence += 1;
      const attemptId = `0198f2a1-1401-7501-8501-${String(sourceConnectionSequence).padStart(12, "0")}`;
      const state = `mock-oauth-state-${String(sourceConnectionSequence).padStart(8, "0")}-${"s".repeat(32)}`;
      const callbackUrl = `${url.origin}/rnet/v0/source-connections/oauth/callback`;
      const bindingCookieName = `rhizome_oauth_${attemptId}`;
      const bindingCookie = `${"b".repeat(41)}${String(sourceConnectionSequence).padStart(2, "0")}`;
      const authorization = new URL(adapter.oauth.authorizationEndpoint);
      authorization.searchParams.set("response_type", "code");
      authorization.searchParams.set("client_id", adapter.manifest.skill_id);
      authorization.searchParams.set("redirect_uri", callbackUrl);
      authorization.searchParams.set("state", state);
      authorization.searchParams.set(
        "code_challenge",
        `${"c".repeat(42)}${String(sourceConnectionSequence).padStart(2, "0")}`,
      );
      authorization.searchParams.set("code_challenge_method", "S256");
      const document = {
        attempt_id: attemptId,
        skill_id: adapter.manifest.skill_id,
        status: "pending",
        intent: input.intent,
        expires_at: "2026-08-28T12:10:00.000Z",
        created_at: "2026-08-28T12:00:00.000Z",
      } satisfies SourceConnectionAttemptDocument;
      const attempt: MockOAuthAttempt = {
        adapter,
        bindingCookie,
        bindingCookieName,
        callbackUrl,
        returnUrl: returnUrl.href,
        state,
        intent: input.intent,
        document,
      };
      oauthAttemptsByState.set(state, attempt);
      oauthAttemptsById.set(attemptId, attempt);
      store.sourceConnectionAttempts.set(attemptId, document);
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        headers: {
          "cache-control": "no-store",
          "set-cookie": `${bindingCookieName}=${bindingCookie}; Path=/rnet/v0/source-connections/oauth/callback; HttpOnly; SameSite=Lax; Max-Age=600`,
        },
        body: JSON.stringify({ ...document, authorization_url: authorization.href }),
      });
    }

    if (method === "GET" && path === "/rnet/v0/source-connections/oauth/callback") {
      const state = url.searchParams.get("state") ?? "";
      const attempt = oauthAttemptsByState.get(state);
      const callbackCookies = request.headers()["cookie"] ?? "";
      if (
        !attempt ||
        attempt.document.status !== "pending" ||
        !callbackCookies
          .split(";")
          .map((part) => part.trim())
          .includes(`${attempt.bindingCookieName}=${attempt.bindingCookie}`)
      ) {
        return problem(route, 422, "source_connection_invalid", "The connection is invalid");
      }
      const code = url.searchParams.get("code");
      const providerError = url.searchParams.get("error");
      if ((code ? 1 : 0) + (providerError ? 1 : 0) !== 1) {
        return problem(route, 422, "source_connection_invalid", "The callback is invalid");
      }

      const completedAt = "2026-08-28T12:00:02.000Z";
      if (providerError) {
        attempt.document = {
          attempt_id: attempt.document.attempt_id,
          skill_id: attempt.document.skill_id,
          status: "rejected",
          intent: attempt.intent,
          error_code: "provider_denied",
          expires_at: attempt.document.expires_at,
          created_at: attempt.document.created_at,
          completed_at: completedAt,
        };
      } else {
        if (code !== attempt.adapter.oauth?.authorizationCode || !attempt.adapter.credentialId) {
          return problem(route, 422, "source_connection_invalid", "The callback is invalid");
        }
        const credential = `credential:${attempt.adapter.credentialId}` as const;
        const credentialDocument = {
          credential,
          skill_id: attempt.adapter.manifest.skill_id,
          connector_version: attempt.adapter.manifest.connector_version,
          status: "active",
          connected_at: completedAt,
        } satisfies SourceCredentialDocument;
        store.sourceCredentials.set(credential, credentialDocument);
        attempt.document = {
          attempt_id: attempt.document.attempt_id,
          skill_id: attempt.document.skill_id,
          status: "succeeded",
          intent: attempt.intent,
          credential,
          expires_at: attempt.document.expires_at,
          created_at: attempt.document.created_at,
          completed_at: completedAt,
        };
      }
      store.sourceConnectionAttempts.set(attempt.document.attempt_id, attempt.document);
      oauthAttemptsByState.delete(state);
      const returnUrl = new URL(attempt.returnUrl);
      returnUrl.searchParams.set("source_connection", attempt.document.attempt_id);
      return route.fulfill({
        status: 303,
        headers: {
          location: returnUrl.href,
          "cache-control": "no-store",
          "set-cookie": `${attempt.bindingCookieName}=; Path=/rnet/v0/source-connections/oauth/callback; HttpOnly; SameSite=Lax; Max-Age=0`,
        },
      });
    }

    const sourceConnectionPath = path.match(/^\/rnet\/v0\/source-connections\/([^/]+)$/);
    if (method === "GET" && sourceConnectionPath) {
      const attempt = oauthAttemptsById.get(sourceConnectionPath[1] ?? "");
      return attempt
        ? json(route, attempt.document)
        : problem(route, 404, "not_found", "The source connection does not exist");
    }

    if (method === "POST" && path === "/rnet/v0/origins") {
      const label = request.headers()["x-rnet-label"] ?? "source-upload";
      const mime = request.headers()["content-type"] ?? "application/octet-stream";
      const upload = installedSourceSkillAdapters
        .map((adapter) => adapter.originUpload)
        .find((candidate) => candidate?.accepts({ label, mime }));
      if (!upload) {
        return problem(route, 422, "schema_violation", "No installed source accepts this file");
      }
      const payload = request.postDataBuffer() ?? Buffer.alloc(0);
      const document = mockOriginDocument({
        byteLength: payload.byteLength,
        contentHash: upload.contentHash,
        id: upload.id,
        label,
        mime,
      });
      store.origins.set(upload.id, {
        byteLength: payload.byteLength,
        document,
        payload: Buffer.from(payload),
      });
      return json(route, document, 201);
    }

    const sourceCredentialPath = path.match(/^\/rnet\/v0\/source-credentials\/([^/]+)$/);
    if (method === "POST" && sourceCredentialPath) {
      const skillId = decodeURIComponent(sourceCredentialPath[1] ?? "");
      const adapter = installedSourceSkillsById.get(skillId);
      if (!adapter?.connect || !adapter.credentialId) {
        return problem(route, 404, "not_found", "The source skill does not exist");
      }
      const connection = await adapter.connect(request.postDataJSON());
      if (!connection.ok) {
        return problem(route, 422, "source_connection_failed", connection.detail);
      }
      const document = {
        credential: `credential:${adapter.credentialId}`,
        skill_id: adapter.manifest.skill_id,
        connector_version: adapter.manifest.connector_version,
        status: "active",
        connected_at: "2026-08-28T12:00:00.000Z",
      } satisfies SourceCredentialDocument;
      store.sourceCredentials.set(document.credential, document);
      return json(route, document, 201);
    }

    if (method === "POST" && path === "/rnet/v0/ingestion-sources") {
      const gate = pendingIngestionSourceCreation;
      pendingIngestionSourceCreation = null;
      if (gate) await gate;
      const input: unknown = request.postDataJSON();
      if (!isRecord(input)) {
        return problem(route, 422, "schema_violation", "The source request must be an object");
      }

      let adapter: MockSourceSkillAdapter | undefined;
      let config: unknown;
      let credentialId: string | undefined;
      let origin: string | undefined;

      if (typeof input.credential === "string") {
        credentialId = input.credential;
        const credential = store.sourceCredentials.get(credentialId);
        if (!credential || credential.status !== "active") {
          return problem(route, 404, "not_found", "The source credential does not exist");
        }
        adapter = installedSourceSkillsById.get(credential.skill_id);
        config = input.config;
      } else if (typeof input.skill_id === "string") {
        adapter = installedSourceSkillsById.get(input.skill_id);
        origin = typeof input.origin === "string" ? input.origin : undefined;
        config = input.config;
      }

      if (!adapter) return problem(route, 404, "not_found", "The source skill does not exist");
      const manifest = adapter.manifest;
      const source = `source:${adapter.sourceId}` as const;
      const common = {
        source,
        skill_id: manifest.skill_id,
        connector_version: manifest.connector_version,
        parser: manifest.parser.name,
        parser_version: manifest.parser.version,
        limits: manifest.limits,
        created_at: "2026-08-28T12:00:01.000Z",
      } as const;

      let document: IngestionSourceDocument;
      if (manifest.source_kind === "file") {
        const originId = origin?.split("/").at(-1) ?? "";
        if (!origin || !store.origins.has(originId)) {
          return problem(route, 404, "not_found", "The OriginArtifact does not exist");
        }
        document = { ...common, kind: "origin", origin };
      } else {
        const normalized = adapter.normalizeConfig?.(config) ?? { ok: true as const, value: {} };
        if (!normalized.ok) {
          return problem(route, 422, "schema_violation", normalized.detail);
        }
        if (manifest.source_kind === "credentialed_remote") {
          if (!credentialId) {
            return problem(route, 422, "schema_violation", "A source credential is required");
          }
          document = { ...common, kind: "credential", config: normalized.value };
          sourceCredentialBindings.set(source, credentialId);
        } else {
          document = { ...common, kind: "remote", config: normalized.value };
        }
      }
      store.ingestionSources.set(source, document);
      return json(route, document, 201);
    }

    const vibeObjects = path.match(/^\/rnet\/v0\/vibes\/([^/]+)\/objects$/);
    if (vibeObjects) {
      const vibe = store.vibes.find((candidate) => candidate.uri.endsWith(`/${vibeObjects[1]}`));
      if (!vibe) return problem(route, 404, "not_found", "The Vibe does not exist");
      if (method === "GET") {
        return json(route, {
          mediaObjects: vibe.objects.flatMap((uri) => {
            const object = store.objects.get(uri.split("/").at(-1) ?? "");
            return object ? [object] : [];
          }),
        });
      }
      if (method === "POST" || method === "DELETE") {
        const input = request.postDataJSON() as { objects: string[] };
        if (method === "POST") vibe.objects.push(...input.objects);
        else vibe.objects = vibe.objects.filter((uri) => !input.objects.includes(uri));
        return noContent(route);
      }
    }

    const pendingImportConfirm = path.match(/^\/rnet\/v0\/imports\/([^/]+)\/confirm$/);
    if (method === "POST" && pendingImportConfirm) {
      const staged = importOperations.get(pendingImportConfirm[1] ?? "");
      if (
        !staged?.pendingVibe ||
        staged.document.status !== "done" ||
        staged.document.committed_at
      ) {
        return problem(route, 422, "import_review_invalid", "The staged import cannot be consumed");
      }
      const input = request.postDataJSON() as { title: string };
      const vibe = {
        rnet_schema: "0.1",
        uri: `rnet://vibe/${NEW_VIBE_ID}`,
        owner: `rnet://id/${OWNER_ID}`,
        title: input.title,
        objects: staged.candidates.map(({ uri }) => uri),
        created_at: "2026-08-28T12:00:04.000Z",
        grants: [],
        inferred: {},
        pull: {
          enabled: true,
          policy: "append_new",
          sources: [staged.source],
        },
      } satisfies Vibe;
      store.vibes.push(vibe);
      for (const candidate of staged.candidates) {
        store.objects.set(candidate.uri.split("/").at(-1) ?? "", candidate);
      }
      for (const element of staged.elements) {
        const id = element.document.uri.split("/").at(-1) ?? "";
        store.elements.set(id, element.document);
        elementPayloads.set(id, element.payload);
      }
      staged.document.committed_at = "2026-08-28T12:00:04.000Z";
      return json(route, vibe);
    }

    const importConfirm = path.match(/^\/rnet\/v0\/vibes\/([^/]+)\/imports\/([^/]+)\/confirm$/);
    if (method === "POST" && importConfirm) {
      const vibe = store.vibes.find((candidate) => candidate.uri.endsWith(`/${importConfirm[1]}`));
      const staged = importOperations.get(importConfirm[2] ?? "");
      if (!vibe || !staged) {
        return problem(route, 404, "not_found", "The staged import does not exist");
      }
      if (staged.document.status !== "done" || staged.document.committed_at) {
        return problem(route, 422, "import_review_invalid", "The staged import cannot be consumed");
      }
      for (const candidate of staged.candidates) {
        const id = candidate.uri.split("/").at(-1) ?? "";
        store.objects.set(id, candidate);
        if (!vibe.objects.includes(candidate.uri)) vibe.objects.push(candidate.uri);
      }
      for (const element of staged.elements) {
        const id = element.document.uri.split("/").at(-1) ?? "";
        store.elements.set(id, element.document);
        elementPayloads.set(id, element.payload);
      }
      const configuredSources = vibe.pull?.sources ?? [];
      vibe.pull = {
        enabled: true,
        policy: vibe.pull?.policy ?? "append_new",
        sources: configuredSources.includes(staged.source)
          ? configuredSources
          : [...configuredSources, staged.source],
      };
      staged.document.committed_at = "2026-08-28T12:00:04.000Z";
      return json(route, vibe);
    }

    const vibeImports = path.match(/^\/rnet\/v0\/vibes\/([^/]+)\/imports$/);
    const pendingVibeImport = path === "/rnet/v0/imports";
    if (method === "POST" && (vibeImports || pendingVibeImport)) {
      const targetVibeId = pendingVibeImport ? NEW_VIBE_ID : vibeImports?.[1];
      const vibe = pendingVibeImport
        ? true
        : store.vibes.find((candidate) => candidate.uri.endsWith(`/${targetVibeId}`));
      if (!vibe) return problem(route, 404, "not_found", "The Vibe does not exist");
      const input: CreateImportPreviewRequest = request.postDataJSON();
      const source = store.ingestionSources.get(input.source);
      if (!source) return problem(route, 404, "not_found", "The ingestion source does not exist");
      const adapter = installedSourceSkillsById.get(source.skill_id);
      if (!adapter) return problem(route, 404, "not_found", "The source skill does not exist");

      if (source.kind === "credential") {
        const credentialId = sourceCredentialBindings.get(source.source);
        const credential = credentialId ? store.sourceCredentials.get(credentialId) : undefined;
        if (!credential || credential.status !== "active") {
          return problem(route, 404, "not_found", "The source credential does not exist");
        }
      }

      let actionResumed = false;
      if (input.continuation_token) {
        const continuation = continuations.get(input.continuation_token);
        if (
          !continuation ||
          continuation.source !== source.source ||
          continuation.skillId !== adapter.manifest.skill_id ||
          continuation.vibeId !== targetVibeId
        ) {
          return problem(route, 422, "schema_violation", "The continuation is invalid or expired");
        }
        continuations.delete(input.continuation_token);
        actionResumed = true;
      }

      const captured =
        source.kind === "origin" ? undefined : await adapter.capture?.(captureContext);
      if (source.kind !== "origin" && !captured) {
        return problem(route, 422, "source_fetch_failed", "The source could not be captured");
      }
      const origin = source.kind === "origin" ? source.origin : captured!.uri;
      const originUpload = store.origins.get(origin.split("/").at(-1) ?? "");
      if (!originUpload) {
        return problem(route, 404, "not_found", "The OriginArtifact does not exist");
      }
      const operationId = adapter.operationId;
      const staged = await adapter.stage({ actionResumed, origin: originUpload });
      const candidates = staged.candidates;
      const verify = staged.verification;
      const elements = staged.elements ?? [];
      const document = {
        operation_id: operationId,
        kind: "pull",
        status: "queued",
        request: {
          mode: "import_preview",
          source: source.source,
          ...(pendingVibeImport ? { pending_destination: { vibe_uuid: NEW_VIBE_ID } } : {}),
          ...(actionResumed ? { action: "review_import" } : {}),
        },
        result: null,
        error: null,
        created_at: "2026-08-28T12:00:02.000Z",
      } satisfies OperationDocument;
      importOperations.set(operationId, {
        candidates,
        ...(staged.destination ? { destination: staged.destination } : {}),
        document,
        elements,
        polls: 0,
        source: source.source,
        verify,
        ...(pendingVibeImport ? { pendingVibe: true } : {}),
      });
      return json(route, document, 202);
    }

    const vibePull = path.match(/^\/rnet\/v0\/vibes\/([^/]+)\/pull$/);
    if (method === "POST" && vibePull) {
      const vibe = store.vibes.find((candidate) => candidate.uri.endsWith(`/${vibePull[1]}`));
      if (!vibe) return problem(route, 404, "not_found", "The Vibe does not exist");
      if (nextSourceAction) {
        const actionRequest = nextSourceAction;
        nextSourceAction = undefined;
        const adapter = installedSourceSkillsById.get(actionRequest.skillId);
        if (!adapter?.sourceAction) throw new Error(`Missing action for ${actionRequest.skillId}`);
        const extensions = actionExtensions(actionRequest, vibePull[1] ?? "");
        const publicDetail = actionRequest.source
          ? adapter.sourceAction.detail
          : "The connected source owner must review an import before pulling again.";
        if (actionRequest.timing === "pull_problem") {
          return problem(route, 422, "source_action_required", publicDetail, extensions);
        }

        pendingPullFailureResult = { code: "source_action_required", ...extensions };
        pendingPullFailureError = actionRequest.source
          ? adapter.sourceAction.operationError
          : publicDetail;
        pullOperation = {
          operation_id: PULL_OPERATION_ID,
          kind: "pull",
          status: "queued",
          request: { mode: "pull", dry_run: false },
          result: null,
          error: null,
          created_at: "2026-08-27T12:03:00.000Z",
        };
        return json(route, pullOperation, 202);
      }
      for (const sourceId of vibe.pull?.sources ?? []) {
        const source = store.ingestionSources.get(sourceId);
        if (!source || source.kind === "origin") continue;
        await installedSourceSkillsById.get(source.skill_id)?.capture?.(captureContext);
      }
      pullOperation = {
        operation_id: PULL_OPERATION_ID,
        kind: "pull",
        status: "done",
        request: { mode: "pull", dry_run: false, sources: vibe.pull?.sources ?? [] },
        result: {
          policy: "append_new",
          dry_run: false,
          candidate_count: 1,
          duplicate_count: 1,
          added_count: 0,
          created_count: 0,
          removed_count: 0,
          candidates: [],
          source_results: [],
        },
        error: null,
        created_at: "2026-08-27T12:03:00.000Z",
        finished_at: "2026-08-27T12:03:00.100Z",
        committed_at: "2026-08-27T12:03:00.100Z",
      };
      return json(route, pullOperation, 202);
    }

    const operationDocument = path.match(/^\/rnet\/v0\/operations\/([^/]+)$/);
    if (method === "GET" && operationDocument) {
      const pushOperation = pushOperations.get(operationDocument[1] ?? "");
      if (pushOperation) {
        pushOperation.polls += 1;
        if (pushOperation.polls === 1) pushOperation.document.status = "running";
        else {
          applyPush(pushOperation, store);
          pushOperation.document.status = "done";
          pushOperation.document.finished_at = "2026-08-27T12:04:00.100Z";
          pushOperation.document.committed_at = "2026-08-27T12:04:00.100Z";
        }
        return json(route, pushOperation.document);
      }
      const staged = importOperations.get(operationDocument[1] ?? "");
      if (staged) {
        staged.polls += 1;
        if (staged.polls === 1) {
          staged.document.status = "running";
        } else if (staged.document.status !== "done") {
          const reviewDigest = `sha256:${"c".repeat(64)}`;
          staged.document.status = "done";
          staged.document.result = {
            candidates: staged.candidates,
            ...(staged.destination ? { destination: staged.destination } : {}),
            elements: staged.elements.map((element) => ({
              uri: element.document.uri,
              kind: element.document.kind,
              mime: element.document.mime,
              byte_size: element.document.byte_size,
              content_hash: element.document.content_hash,
              preview_url: element.preview_url,
              object_uri: element.object_uri,
              role: element.role,
              ...(element.alt !== undefined ? { alt: element.alt } : {}),
            })),
            verify: staged.verify,
            source_digest: `sha256:${"d".repeat(64)}`,
            review_digest: reviewDigest,
          };
          staged.document.review_digest = reviewDigest;
          staged.document.finished_at = "2026-08-28T12:00:03.000Z";
        }
        return json(route, staged.document);
      }
      if (operationDocument[1] === PULL_OPERATION_ID && pullOperation && pendingPullFailureResult) {
        pullOperation.status = "failed";
        pullOperation.result = pendingPullFailureResult;
        pullOperation.error = pendingPullFailureError ?? "The source requires owner review.";
        pullOperation.finished_at = "2026-08-27T12:03:00.100Z";
        pendingPullFailureResult = undefined;
        pendingPullFailureError = undefined;
      }
      return operationDocument[1] === PULL_OPERATION_ID && pullOperation
        ? json(route, pullOperation)
        : problem(route, 404, "not_found", "The operation does not exist");
    }

    const previewElementBytes = path.match(
      /^\/rnet\/v0\/operations\/([^/]+)\/elements\/([^/]+)\/bytes$/,
    );
    if (method === "GET" && previewElementBytes) {
      const staged = importOperations.get(previewElementBytes[1] ?? "");
      const element = staged?.elements.find((candidate) =>
        candidate.document.uri.endsWith(`/${previewElementBytes[2]}`),
      );
      if (!element) return problem(route, 404, "not_found", "The element preview does not exist");
      if (!request.headers()["authorization"]?.startsWith("Bearer ")) {
        return problem(route, 401, "authentication_required", "Authentication is required");
      }
      return route.fulfill({
        status: 200,
        contentType:
          element.document.kind === "text"
            ? `${element.document.mime}; charset=utf-8`
            : element.document.mime,
        body: element.payload,
      });
    }

    const vibeDocument = path.match(/^\/rnet\/v0\/vibes\/([^/]+)$/);
    if (vibeDocument) {
      const id = vibeDocument[1] ?? "";
      const vibe = store.vibes.find((candidate) => candidate.uri.endsWith(`/${vibeDocument[1]}`));
      if (!vibe) return problem(route, 404, "not_found", "The Vibe does not exist");
      if (method === "GET") return json(route, vibe);
      if (method === "PATCH") {
        const input = request.postDataJSON() as { title?: string };
        if (input.title !== undefined) vibe.title = input.title;
        return json(route, vibe);
      }
      if (method === "DELETE") {
        store.vibes.splice(
          store.vibes.findIndex((candidate) => candidate.uri.endsWith(`/${id}`)),
          1,
        );
        return noContent(route);
      }
    }

    const pushVibe = path.match(/^\/rnet\/v0\/vibes\/([^/]+)\/push$/);
    if (method === "POST" && pushVibe) {
      const input = request.postDataJSON() as PushVibeRequest;
      const installed = [
        ...Object.values(PUSH_TASKS.vibe),
        ...Object.values(PUSH_TASKS.object),
      ].some((task) => task.level === input.level && task.name === input.task);
      if (!installed)
        return problem(route, 422, "schema_violation", "The push task is not installed");
      pushSequence += 1;
      const operationId = `0198f2a1-e4cf-7add-99bc-${String(pushSequence).padStart(12, "0")}`;
      const pushOperation: MockPushOperation = {
        input,
        polls: 0,
        applied: false,
        vibeId: pushVibe[1] ?? "",
        document: {
          operation_id: operationId,
          kind: "push",
          status: "queued",
          request: { mode: "push", vibe: `rnet://vibe/${pushVibe[1]}`, ...input },
          result: null,
          error: null,
          created_at: "2026-08-27T12:04:00.000Z",
        },
      };
      pushOperations.set(operationId, pushOperation);
      return json(route, pushOperation.document, 202);
    }

    const elementBytes = path.match(/^\/rnet\/v0\/elements\/([^/]+)\/bytes$/);
    if (method === "GET" && elementBytes) {
      const element = store.elements.get(elementBytes[1] ?? "");
      if (!element) return problem(route, 404, "not_found", "The element does not exist");
      return route.fulfill({
        status: 200,
        contentType: element.kind === "text" ? `${element.mime}; charset=utf-8` : element.mime,
        body: elementPayloads.get(elementBytes[1] ?? "") ?? Buffer.from(PAYLOAD_TEXT),
      });
    }

    const elementDocument = path.match(/^\/rnet\/v0\/elements\/([^/]+)$/);
    if (method === "GET" && elementDocument) {
      const element = store.elements.get(elementDocument[1] ?? "");
      return element
        ? json(route, element)
        : problem(route, 404, "not_found", "The element does not exist");
    }

    const objectDocument = path.match(/^\/rnet\/v0\/objects\/([^/]+)$/);
    if (method === "GET" && objectDocument) {
      const object = store.objects.get(objectDocument[1] ?? "");
      return object
        ? json(route, object)
        : problem(route, 404, "not_found", "The object does not exist");
    }

    const setUser = path.match(/^\/rnet\/v0\/objects\/([^/]+)\/user$/);
    if (method === "PATCH" && setUser) {
      const gate = pendingUserWrite;
      pendingUserWrite = null;
      if (gate) await gate;
      const id = setUser[1] ?? "";
      const object = store.objects.get(id);
      if (!object) return problem(route, 404, "not_found", "The object does not exist");
      const input = request.postDataJSON() as { properties: Record<string, unknown> };
      const updated: MediaObject = {
        ...object,
        user: { properties: input.properties, updated_at: "2026-08-27T12:01:00.000Z" },
      };
      store.objects.set(id, updated);
      return json(route, updated);
    }

    return problem(route, 404, "not_found", `No mock route for ${method} ${path}`);
  });

  return store;
}
