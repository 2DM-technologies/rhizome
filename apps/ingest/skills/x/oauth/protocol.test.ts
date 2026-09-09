import { describe, expect, test } from "bun:test";

import type { SourceExecutionLimits } from "../../../../../packages/store-contract/src/source-skills.ts";
import {
  CredentialConnectionError,
  ConnectedSourceError,
} from "../../../connected-sources/types.ts";
import { captureXOAuthTimeline } from "./capture.ts";
import { XApiClient, XApiClientError, type XFetchLike } from "./client.ts";
import {
  loadXOAuthSettings,
  X_OAUTH_BUDGET_ENABLED_ENV,
  X_OAUTH_CLIENT_ID_ENV,
  X_OAUTH_CLIENT_SECRET_ENV,
} from "./config.ts";
import {
  createXOAuthConnection,
  parseXOAuthSecret,
  serializeXOAuthSecret,
  X_OAUTH_SCOPES,
} from "./oauth.ts";
import { parseXOAuthCapture } from "./parser.ts";

const settings = { clientId: "x-client", budgetEnabled: true } as const;
const endpoints = {
  authorization: "https://x.test/i/oauth2/authorize",
  token: "https://api.x.test/2/oauth2/token",
  revoke: "https://api.x.test/2/oauth2/revoke",
  apiBase: "https://api.x.test/2",
} as const;
const tokenResponse = {
  token_type: "bearer",
  access_token: "access-token",
  refresh_token: "refresh-token",
  expires_in: 7_200,
  scope: X_OAUTH_SCOPES.join(" "),
};
const identityResponse = {
  data: { id: "2244994945", username: "XDevelopers", name: "X Developers" },
};
const noAbort = new AbortController().signal;

describe("X OAuth provider protocol", () => {
  test("stays disabled until exact operator configuration and budget consent are present", () => {
    expect(loadXOAuthSettings({})).toBeUndefined();
    expect(loadXOAuthSettings({ [X_OAUTH_CLIENT_ID_ENV]: "configured" })).toEqual({
      clientId: "configured",
      budgetEnabled: false,
    });
    expect(() => loadXOAuthSettings({ [X_OAUTH_BUDGET_ENABLED_ENV]: "TRUE" })).toThrow(
      "must be either true or false",
    );
    expect(() => loadXOAuthSettings({ [X_OAUTH_BUDGET_ENABLED_ENV]: "true" })).toThrow(
      X_OAUTH_CLIENT_ID_ENV,
    );
    expect(
      loadXOAuthSettings({
        [X_OAUTH_BUDGET_ENABLED_ENV]: "true",
        [X_OAUTH_CLIENT_ID_ENV]: "configured",
        [X_OAUTH_CLIENT_SECRET_ENV]: "server-secret",
      }),
    ).toEqual({ clientId: "configured", clientSecret: "server-secret", budgetEnabled: true });
    expect(() =>
      loadXOAuthSettings({
        [X_OAUTH_BUDGET_ENABLED_ENV]: "true",
        [X_OAUTH_CLIENT_ID_ENV]: "bad\nclient",
      }),
    ).toThrow("is invalid");
  });

  test("requests only the exact scopes, exchanges PKCE on the server, and verifies identity", async () => {
    const requests: Request[] = [];
    const connection = connectionWith(async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url === endpoints.token) return json(tokenResponse);
      if (request.url === `${endpoints.apiBase}/users/me`) return json(identityResponse);
      throw new Error(`Unexpected request ${request.url}`);
    });
    const authorization = new URL(
      connection.authorizationUrl({
        callbackUrl: "https://rhizome.test/api/source-connections/callback",
        codeChallenge: "challenge-value",
        state: "state-value",
      }),
    );
    expect(Object.fromEntries(authorization.searchParams)).toEqual({
      response_type: "code",
      client_id: "x-client",
      redirect_uri: "https://rhizome.test/api/source-connections/callback",
      scope: "tweet.read users.read offline.access",
      state: "state-value",
      code_challenge: "challenge-value",
      code_challenge_method: "S256",
    });

    const result = await connection.exchange({
      callbackUrl: "https://rhizome.test/api/source-connections/callback",
      code: "authorization-code",
      codeVerifier: "pkce-verifier",
      signal: noAbort,
    });
    expect(result.publicMetadata).toEqual({
      account_id: "2244994945",
      account_handle: "XDevelopers",
      account_name: "X Developers",
    });
    expect(parseXOAuthSecret(result.secret)).toEqual({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAtEpoch: 1_700_007_200,
      account: { id: "2244994945", handle: "XDevelopers", name: "X Developers" },
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.headers.get("Authorization")).toBeNull();
    expect(await requests[0]?.clone().text()).toBe(
      "grant_type=authorization_code&code=authorization-code&redirect_uri=https%3A%2F%2Frhizome.test%2Fapi%2Fsource-connections%2Fcallback&code_verifier=pkce-verifier&client_id=x-client",
    );
    expect(requests[1]?.headers.get("Authorization")).toBe("Bearer access-token");
  });

  test("uses documented Basic authentication for confidential clients", async () => {
    let tokenRequest: Request | undefined;
    const connection = createXOAuthConnection(
      { clientId: "confidential", clientSecret: "server-secret", budgetEnabled: true },
      {
        endpoints,
        now: fixedNow,
        fetch: async (input, init) => {
          const request = new Request(input, init);
          if (request.url === endpoints.token) {
            tokenRequest = request;
            return json(tokenResponse);
          }
          return json(identityResponse);
        },
      },
    );
    await connection.exchange({
      callbackUrl: "https://rhizome.test/callback",
      code: "authorization-code",
      codeVerifier: "pkce-verifier",
      signal: noAbort,
    });
    expect(tokenRequest?.headers.get("Authorization")).toBe(
      `Basic ${Buffer.from("confidential:server-secret").toString("base64")}`,
    );
    expect(await tokenRequest?.clone().text()).not.toContain("client_id");
  });

  test("rejects incomplete, excess-scope, and control-character token responses", async () => {
    for (const response of [
      { ...tokenResponse, scope: "tweet.read users.read" },
      { ...tokenResponse, scope: `${tokenResponse.scope} follows.read` },
      { ...tokenResponse, scope: `${tokenResponse.scope} tweet.read` },
      { ...tokenResponse, refresh_token: undefined },
      { ...tokenResponse, expires_in: 0 },
      { ...tokenResponse, access_token: "access\u0000token" },
    ]) {
      const connection = connectionWith(async (input) =>
        String(input) === endpoints.token ? json(response) : new Response(null),
      );
      await expect(
        connection.exchange({
          callbackUrl: "https://rhizome.test/callback",
          code: "authorization-code",
          codeVerifier: "pkce-verifier",
          signal: noAbort,
        }),
      ).rejects.toBeInstanceOf(CredentialConnectionError);
    }
    expect(() =>
      serializeXOAuthSecret({
        accessToken: "access\u0000token",
        refreshToken: "refresh-token",
        expiresAtEpoch: 1_700_000_001,
        account: { id: "2244994945", handle: "XDevelopers" },
      }),
    ).toThrow("stored X connection is invalid");
  });

  test("uses a fresh bounded signal to revoke an issued token after identity failure", async () => {
    const caller = new AbortController();
    const revokeSignals: AbortSignal[] = [];
    const connection = connectionWith(async (input, init) => {
      const url = String(input);
      if (url === endpoints.token) return json(tokenResponse);
      if (url === `${endpoints.apiBase}/users/me`) {
        caller.abort(new Error("deadline"));
        throw caller.signal.reason;
      }
      if (url === endpoints.revoke) {
        revokeSignals.push(init?.signal as AbortSignal);
        return new Response(null, { status: 200 });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    await expect(
      connection.exchange({
        callbackUrl: "https://rhizome.test/callback",
        code: "authorization-code",
        codeVerifier: "pkce-verifier",
        signal: caller.signal,
      }),
    ).rejects.toBeInstanceOf(CredentialConnectionError);
    expect(revokeSignals).toHaveLength(2);
    expect(revokeSignals.every((signal) => signal !== caller.signal && !signal.aborted)).toBe(true);
  });

  test("rejects an authenticated identity with an invalid provider handle", async () => {
    const connection = connectionWith(async (input) => {
      const url = String(input);
      if (url === endpoints.token) return json(tokenResponse);
      if (url === `${endpoints.apiBase}/users/me`) {
        return json({ data: { id: "2244994945", username: "bad/handle", name: "Safe name" } });
      }
      if (url === endpoints.revoke) return new Response(null, { status: 200 });
      throw new Error(`Unexpected request ${url}`);
    });
    await expect(
      connection.exchange({
        callbackUrl: "https://rhizome.test/callback",
        code: "authorization-code",
        codeVerifier: "pkce-verifier",
        signal: noAbort,
      }),
    ).rejects.toBeInstanceOf(CredentialConnectionError);
  });

  test("never drops expiry during refresh and rejects non-success revocation", async () => {
    const secret = serializeXOAuthSecret({
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAtEpoch: 1_700_000_001,
      account: { id: "2244994945", handle: "XDevelopers", name: "X Developers" },
    });
    const missingExpiry = connectionWith(async (input) =>
      String(input) === endpoints.token
        ? json({ ...tokenResponse, access_token: "new-access", expires_in: undefined })
        : new Response(null),
    );
    await expect(missingExpiry.refresh?.(secret, { signal: noAbort })).rejects.toBeInstanceOf(
      CredentialConnectionError,
    );

    const rejectingClient = new XApiClient({
      endpoints,
      fetch: async () => new Response(null, { status: 503 }),
    });
    await expect(
      rejectingClient.revokeToken(settings, "access-token", noAbort),
    ).rejects.toMatchObject({
      kind: "provider_rejected",
      evidence: { httpStatus: 503 },
    });
  });

  test("attempts the complete unique token set when provider revocation partially fails", async () => {
    const revoked: string[] = [];
    const connection = connectionWith(async (input, init) => {
      if (String(input) !== endpoints.revoke) throw new Error(`Unexpected request ${input}`);
      revoked.push(new URLSearchParams(await new Request(input, init).text()).get("token") ?? "");
      return new Response(null, { status: revoked.length === 1 ? 503 : 200 });
    });
    const secret = serializeXOAuthSecret({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      account: { id: "2244994945", handle: "XDevelopers" },
    });

    await expect(connection.revoke!(secret, { signal: noAbort })).rejects.toBeInstanceOf(
      CredentialConnectionError,
    );
    expect(revoked).toEqual(["refresh-token", "access-token"]);
  });

  test("builds the exact one-page timeline query and strictly rejects malformed optional fields", async () => {
    const requests: Request[] = [];
    const client = new XApiClient({
      endpoints,
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return json({ data: [], meta: { result_count: 0 } });
      },
    });
    expect(await client.getUserTimeline("access-token", "2244994945", {}, noAbort)).toEqual({
      data: [],
      includes: { media: [] },
      meta: { result_count: 0 },
    });
    const url = new URL(requests[0]!.url);
    expect(url.searchParams.get("max_results")).toBe("100");
    expect(url.searchParams.get("exclude")).toBe("replies,retweets");
    expect(url.href).not.toContain("undefined");

    const malformed = new XApiClient({
      endpoints,
      fetch: async () => json({ data: [], meta: { result_count: 0, newest_id: 42 } }),
    });
    await expect(
      malformed.getUserTimeline("access-token", "2244994945", {}, noAbort),
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });

  test("sanitizes common structured entity categories before capture", async () => {
    const client = new XApiClient({
      endpoints,
      fetch: async () =>
        json({
          data: [
            {
              id: "100",
              text: "@Friend #Topic $CASH https://t.co/link",
              author_id: "2244994945",
              created_at: "2026-08-20T10:00:00.000Z",
              edit_history_tweet_ids: ["100"],
              entities: {
                mentions: [{ start: 0, end: 7, username: "Friend" }],
                hashtags: [{ start: 8, end: 14, tag: "Topic" }],
                cashtags: [{ start: 15, end: 20, tag: "CASH" }],
                urls: [
                  {
                    start: 21,
                    end: 38,
                    url: "https://t.co/link",
                    expanded_url: "https://example.test/link",
                    display_url: "example.test/link",
                  },
                ],
                annotations: [{ arbitrary: { nested: "provider-only" } }],
              },
            },
          ],
          meta: { result_count: 1, newest_id: "100", oldest_id: "100" },
        }),
    });

    const page = await client.getUserTimeline("access-token", "2244994945", {}, noAbort);
    expect(page.data[0]!.entities).toEqual({
      urls: [
        {
          start: 21,
          end: 38,
          url: "https://t.co/link",
          expanded_url: "https://example.test/link",
        },
      ],
      mentions: [{ start: 0, end: 7, username: "Friend" }],
      hashtags: [{ start: 8, end: 14, tag: "Topic" }],
      cashtags: [{ start: 15, end: 20, tag: "CASH" }],
    });
    expect(JSON.stringify(page)).not.toContain("provider-only");
  });

  test("maps bounded rate-limit evidence without exposing provider response bodies", async () => {
    const client = new XApiClient({
      endpoints,
      fetch: async () =>
        new Response('{"detail":"SECRET provider message"}', {
          status: 429,
          headers: { "Retry-After": "12", "x-rate-limit-reset": "1800000000" },
        }),
    });
    let failure: unknown;
    try {
      await client.getAuthenticatedUser("access-token", noAbort);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      kind: "rate_limited",
      evidence: { retryAfterSeconds: 12, rateLimitResetEpoch: 1_800_000_000 },
    });
    expect(JSON.stringify(failure)).not.toContain("SECRET");
  });

  test("captures selected photo and deterministic direct MP4 bytes in a bounded ZIP", async () => {
    const mediaRequests: string[] = [];
    const client = new XApiClient({
      endpoints,
      mediaHosts: ["pbs.twimg.test", "video.twimg.test"],
      fetch: async (input) => {
        const url = String(input);
        if (url === `${endpoints.apiBase}/users/me`) return json(identityResponse);
        if (url.startsWith(`${endpoints.apiBase}/users/2244994945/tweets?`)) {
          return json(timelineFixture());
        }
        mediaRequests.push(url);
        if (url === "https://pbs.twimg.test/media/photo.jpg") {
          return new Response("photo", { headers: { "Content-Type": "image/jpeg" } });
        }
        if (url === "https://video.twimg.test/high.mp4") {
          return new Response("video", { headers: { "Content-Type": "video/mp4" } });
        }
        throw new Error(`Unexpected media request ${url}`);
      },
    });
    const secret = serializeXOAuthSecret({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAtEpoch: 1_800_000_000,
      account: { id: "2244994945", handle: "OldHandle", name: "Old name" },
    });
    const bytes = await captureXOAuthTimeline({
      client,
      secret,
      limits,
      signal: noAbort,
      now: () => new Date("2025-01-02T00:00:00.000Z"),
    });
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(bytes.byteLength).toBeLessThanOrEqual(limits.maxCaptureBytes);
    expect(mediaRequests).toEqual([
      "https://pbs.twimg.test/media/photo.jpg",
      "https://video.twimg.test/high.mp4",
    ]);
    const parsed = await parseXOAuthCapture(bytes, limits);
    expect(parsed.selection.account).toEqual({
      id: "2244994945",
      handle: "XDevelopers",
      name: "X Developers",
    });
    expect(parsed.selection.posts).toHaveLength(1);
    expect(parsed.selection.posts[0]?.attachments).toMatchObject([
      { status: "available", kind: "image", mime: "image/jpeg", sourceRef: "media-photo" },
      { status: "available", kind: "video", mime: "video/mp4", sourceRef: "media-video" },
      { status: "omitted", reason: "unsupported_media", sourceRef: "media-unsafe" },
    ]);
    expect(parsed.manifest.request).toEqual({
      maxResults: 100,
      exclude: ["replies", "retweets"],
    });
  });

  test("classifies a streaming oversized element before the tighter aggregate budget", async () => {
    const tightLimits = {
      ...limits,
      maxElementBytes: 5,
      maxTotalElementBytes: 3,
    };
    const client = new XApiClient({
      endpoints,
      mediaHosts: ["pbs.twimg.test"],
      fetch: async (input) => {
        const url = String(input);
        if (url === `${endpoints.apiBase}/users/me`) return json(identityResponse);
        if (url.startsWith(`${endpoints.apiBase}/users/2244994945/tweets?`)) {
          return json({
            data: [
              {
                id: "100",
                text: "A",
                author_id: "2244994945",
                created_at: "2025-01-01T12:00:00.000Z",
                edit_history_tweet_ids: ["100"],
                attachments: { media_keys: ["photo"] },
              },
            ],
            includes: {
              media: [
                {
                  media_key: "photo",
                  type: "photo",
                  url: "https://pbs.twimg.test/media/oversized.jpg",
                },
              ],
            },
            meta: { result_count: 1, newest_id: "100", oldest_id: "100" },
          });
        }
        if (url === "https://pbs.twimg.test/media/oversized.jpg") {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("123456"));
                controller.close();
              },
            }),
            { headers: { "Content-Type": "image/jpeg" } },
          );
        }
        throw new Error(`Unexpected provider request ${url}`);
      },
    });
    const secret = serializeXOAuthSecret({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAtEpoch: 1_800_000_000,
      account: { id: "2244994945", handle: "XDevelopers" },
    });

    const bytes = await captureXOAuthTimeline({
      client,
      secret,
      limits: tightLimits,
      signal: noAbort,
    });
    const parsed = await parseXOAuthCapture(bytes, tightLimits);
    expect(parsed.manifest.mediaOmissions).toEqual([
      {
        postId: "100",
        attachmentIndex: 0,
        mediaKey: "photo",
        sourceUrl: "https://pbs.twimg.test/media/oversized.jpg",
        reason: "element_too_large",
        kind: "image",
      },
    ]);
  });

  test("cannot finish capture work after its deadline aborts during a media response", async () => {
    const controller = new AbortController();
    const abortReason = new Error("synthetic X capture deadline");
    const client = new XApiClient({
      endpoints,
      mediaHosts: ["pbs.twimg.test", "video.twimg.test"],
      fetch: async (input) => {
        const url = String(input);
        if (url === `${endpoints.apiBase}/users/me`) return json(identityResponse);
        if (url.startsWith(`${endpoints.apiBase}/users/2244994945/tweets?`)) {
          return json(timelineFixture());
        }
        if (url === "https://pbs.twimg.test/media/photo.jpg") {
          controller.abort(abortReason);
          return new Response("photo", { headers: { "Content-Type": "image/jpeg" } });
        }
        throw new Error(`Unexpected provider request ${url}`);
      },
    });
    const secret = serializeXOAuthSecret({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAtEpoch: 1_800_000_000,
      account: { id: "2244994945", handle: "XDevelopers" },
    });

    let failure: unknown;
    try {
      await captureXOAuthTimeline({ client, secret, limits, signal: controller.signal });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBe(abortReason);
  });

  test("surfaces capture rate limits as generic safe 429 failures", async () => {
    const client = new XApiClient({
      endpoints,
      fetch: async (input) =>
        String(input).endsWith("/users/me")
          ? json(identityResponse)
          : new Response("provider-private", {
              status: 429,
              headers: { "Retry-After": "9" },
            }),
    });
    const secret = serializeXOAuthSecret({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAtEpoch: 1_800_000_000,
      account: { id: "2244994945", handle: "XDevelopers" },
    });
    await expect(
      captureXOAuthTimeline({ client, secret, limits, signal: noAbort }),
    ).rejects.toMatchObject({ status: 429, code: "rate_limited" });
    try {
      await captureXOAuthTimeline({ client, secret, limits, signal: noAbort });
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectedSourceError);
      expect(JSON.stringify(error)).not.toContain("provider-private");
    }
  });
});

function connectionWith(fetch: XFetchLike) {
  return createXOAuthConnection(settings, { endpoints, fetch, now: fixedNow });
}

function fixedNow(): Date {
  return new Date("2023-11-14T22:13:20.000Z");
}

function json(value: unknown): Response {
  return Response.json(value);
}

const limits: SourceExecutionLimits = {
  maxCandidates: 100,
  maxCaptureBytes: 1_024 * 1_024,
  maxElementBytes: 1_024,
  maxTotalElementBytes: 8 * 1_024,
};

function timelineFixture() {
  return {
    data: [
      {
        id: "1900000000000000001",
        text: "A post with media",
        author_id: "2244994945",
        created_at: "2025-01-01T12:00:00.000Z",
        conversation_id: "1900000000000000001",
        edit_history_tweet_ids: ["1900000000000000001"],
        attachments: { media_keys: ["media-photo", "media-video", "media-unsafe"] },
      },
    ],
    includes: {
      media: [
        {
          media_key: "media-photo",
          type: "photo",
          url: "https://pbs.twimg.test/media/photo.jpg",
          alt_text: "A photograph",
        },
        {
          media_key: "media-video",
          type: "video",
          variants: [
            {
              content_type: "video/mp4",
              bit_rate: 128_000,
              url: "https://video.twimg.test/low.mp4",
            },
            { content_type: "application/x-mpegURL", url: "https://video.twimg.test/index.m3u8" },
            {
              content_type: "video/mp4",
              bit_rate: 256_000,
              url: "https://video.twimg.test/high.mp4",
            },
          ],
        },
        {
          media_key: "media-unsafe",
          type: "photo",
          url: "https://evil.test/not-fetched.jpg",
        },
      ],
    },
    meta: {
      result_count: 1,
      newest_id: "1900000000000000001",
      oldest_id: "1900000000000000001",
      next_token: "ignored-because-one-page-only",
    },
  };
}
