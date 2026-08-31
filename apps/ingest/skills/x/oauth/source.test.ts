import { describe, expect, test } from "bun:test";

import { ConnectedSourceError } from "../../../connected-sources/types.ts";
import { X_SOURCE_LIMITS } from "../definition.ts";
import { serializeXOAuthSecret } from "./oauth.ts";
import { parseXOAuthCapture } from "./parser.ts";
import { createXOAuthSkill, xOAuthSourceConfigSchema } from "./source.ts";

const settings = { clientId: "x-client", budgetEnabled: true } as const;
const now = () => new Date("2026-08-21T12:00:00.000Z");

describe("X OAuth connected-source adapter", () => {
  test("declares generic OAuth/candidate capabilities and accepts only an empty source config", () => {
    const skill = createXOAuthSkill(settings, { fetch: unreachableFetch });
    expect(skill).toMatchObject({
      skillId: "x_oauth",
      displayName: "X account",
      parser: { name: "x-posts", version: "x-posts@1" },
      connection: { mode: "oauth2_pkce" },
      sourceRequestSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      fetchPolicy: { attempts: 24, windowHours: 24 },
      capture: { mime: "application/vnd.rhizome.x-oauth-capture+zip" },
    });
    expect(skill.manifest.input_fields).toEqual([]);
    expect(xOAuthSourceConfigSchema).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    });
    expect(skill.parseConfig({})).toEqual({});
    expect(() => skill.parseConfig({ account: "42" })).toThrow("configuration is invalid");
    expect(() => skill.parseConfig(null)).toThrow("configuration is invalid");
    expect(() => skill.parseConfig(new Date())).toThrow("configuration is invalid");
    expect(skill.capture.label("fetch-1")).toBe("x-oauth-fetch-1.zip");
  });

  test("captures exactly one 100-result page and compiles through the shared X bundle", async () => {
    const provider = mockProvider([
      timeline([
        {
          id: "105",
          text: "Exact provider text",
          author_id: "42",
          created_at: "2026-08-20T10:00:00.000Z",
          conversation_id: "105",
          edit_history_tweet_ids: ["105"],
        },
      ]),
    ]);
    const skill = createXOAuthSkill(settings, provider.options);
    const prepared = await skill.prepareFetch({
      config: {},
      endDateEpoch: 1_800_000_000,
      limits: X_SOURCE_LIMITS,
    });
    const bytes = await prepared.retrieve(secret(), { signal: new AbortController().signal });
    const bundle = await prepared.compiledSource.compile({ bytes, limits: X_SOURCE_LIMITS });

    expect(bundle.candidates).toHaveLength(1);
    expect(bundle.candidates[0]).toMatchObject({
      type: "tweet",
      keys: { x_tweet_id: "105", x_author_id: "42" },
      sourceProperties: { published_at: "2026-08-20T10:00:00.000Z" },
    });
    expect(new TextDecoder().decode(bundle.candidates[0]!.elements[0]!.bytes)).toBe(
      "Exact provider text",
    );
    expect(bundle.destination).toEqual({ title: "@example_user Tweets" });
    expect(provider.identityCalls).toBe(1);
    expect(provider.timelineCalls).toHaveLength(1);
    const request = provider.timelineCalls[0]!;
    expect(request.searchParams.get("max_results")).toBe("100");
    expect(request.searchParams.get("exclude")).toBe("replies,retweets");
    expect(request.searchParams.get("pagination_token")).toBeNull();
    expect(request.searchParams.get("start_time")).toBeNull();
    expect(request.searchParams.get("tweet.fields")?.split(",")).toEqual([
      "attachments",
      "author_id",
      "conversation_id",
      "created_at",
      "edit_history_tweet_ids",
      "entities",
      "lang",
      "possibly_sensitive",
      "referenced_tweets",
    ]);
    expect(request.searchParams.get("tweet.fields")).not.toContain("public_metrics");
    expect(provider.authorizations).toEqual(["Bearer access-token", "Bearer access-token"]);
  });

  test("persists the newest checkpoint, requests a 30-minute edit overlap, and treats absence as no deletion", async () => {
    const provider = mockProvider([
      timeline([
        {
          id: "105",
          text: "Initial record",
          author_id: "42",
          created_at: "2026-08-20T10:00:00.000Z",
          edit_history_tweet_ids: ["105"],
        },
      ]),
      timeline([]),
    ]);
    const skill = createXOAuthSkill(settings, provider.options);
    const first = await skill.prepareFetch({
      config: {},
      endDateEpoch: 1_800_000_000,
      limits: X_SOURCE_LIMITS,
    });
    const firstBytes = await first.retrieve(secret(), { signal: new AbortController().signal });
    const firstCapture = await parseXOAuthCapture(firstBytes, X_SOURCE_LIMITS);
    expect(firstCapture.manifest.checkpoint).toEqual({
      newestSeenId: "105",
      newestSeenPublishedAt: "2026-08-20T10:00:00.000Z",
      overlapStartTime: "2026-08-20T09:30:00.000Z",
    });

    const second = await skill.prepareFetch({
      config: {},
      endDateEpoch: 1_800_000_100,
      limits: X_SOURCE_LIMITS,
      previousCapture: firstBytes,
    });
    const secondBytes = await second.retrieve(secret(), {
      signal: new AbortController().signal,
    });
    const secondCapture = await parseXOAuthCapture(secondBytes, X_SOURCE_LIMITS);
    const secondBundle = await second.compiledSource.compile({
      bytes: secondBytes,
      limits: X_SOURCE_LIMITS,
    });

    expect(provider.timelineCalls).toHaveLength(2);
    expect(provider.timelineCalls[1]!.searchParams.get("start_time")).toBe(
      "2026-08-20T09:30:00.000Z",
    );
    expect(provider.timelineCalls[1]!.searchParams.get("since_id")).toBeNull();
    expect(secondCapture.manifest.request.previousCheckpoint).toEqual(
      firstCapture.manifest.checkpoint,
    );
    expect(secondCapture.manifest.checkpoint).toEqual(firstCapture.manifest.checkpoint);
    expect(secondBundle.candidates).toEqual([]);
    expect(secondBundle.verify).toMatchObject({ ok: true, candidate_count: 0, eligible_count: 0 });
    expect(JSON.stringify(secondBundle)).not.toContain("delet");
  });

  test("revalidates the sealed account before timeline access and exposes no credential detail", async () => {
    const provider = mockProvider([timeline([])], { identityId: "99" });
    const skill = createXOAuthSkill(settings, provider.options);
    const prepared = await skill.prepareFetch({
      config: {},
      endDateEpoch: 1_800_000_000,
      limits: X_SOURCE_LIMITS,
    });

    let failure: unknown;
    try {
      await prepared.retrieve(secret(), { signal: new AbortController().signal });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ConnectedSourceError);
    expect(failure).toMatchObject({ status: 422, code: "source_connection_failed" });
    expect(provider.identityCalls).toBe(1);
    expect(provider.timelineCalls).toEqual([]);
    expect(JSON.stringify(failure)).not.toContain("access-token");
  });

  test("rejects a capture whose persisted limits differ from the effective compilation limits", async () => {
    const provider = mockProvider([timeline([])]);
    const skill = createXOAuthSkill(settings, provider.options);
    const prepared = await skill.prepareFetch({
      config: {},
      endDateEpoch: 1_800_000_000,
      limits: X_SOURCE_LIMITS,
    });
    const bytes = await prepared.retrieve(secret(), { signal: new AbortController().signal });
    await expect(
      prepared.compiledSource.compile({
        bytes,
        limits: { ...X_SOURCE_LIMITS, maxElementBytes: X_SOURCE_LIMITS.maxElementBytes - 1 },
      }),
    ).rejects.toThrow("capture limits do not match");
  });
});

function secret(): string {
  return serializeXOAuthSecret({
    accessToken: "access-token",
    refreshToken: "refresh-token",
    account: { id: "42", handle: "example_user", name: "Example User" },
  });
}

function timeline(data: readonly Record<string, unknown>[]) {
  return {
    data,
    includes: { media: [] },
    meta: {
      result_count: data.length,
      ...(data[0]?.id ? { newest_id: data[0].id } : {}),
      ...(data.at(-1)?.id ? { oldest_id: data.at(-1)!.id } : {}),
    },
  };
}

function mockProvider(
  timelineResponses: readonly Record<string, unknown>[],
  input: { identityId?: string } = {},
) {
  const queue = [...timelineResponses];
  const timelineCalls: URL[] = [];
  const authorizations: string[] = [];
  let identityCalls = 0;
  const fetch = async (request: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(request));
    const authorization = new Headers(init?.headers).get("Authorization");
    if (authorization) authorizations.push(authorization);
    if (url.pathname === "/2/users/me") {
      identityCalls += 1;
      return json({
        data: {
          id: input.identityId ?? "42",
          username: "example_user",
          name: "Example User",
        },
      });
    }
    if (url.pathname === "/2/users/42/tweets") {
      timelineCalls.push(url);
      const response = queue.shift();
      if (!response) throw new Error("Unexpected extra X timeline request");
      return json(response);
    }
    throw new Error(`Unexpected provider URL: ${url}`);
  };
  return {
    options: {
      fetch,
      endpoints: { apiBase: "https://api.x.test/2" },
      mediaHosts: ["media.x.test"],
      now,
    },
    get identityCalls() {
      return identityCalls;
    },
    timelineCalls,
    authorizations,
  };
}

function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...Object.fromEntries(new Headers(headers)) },
  });
}

async function unreachableFetch(): Promise<Response> {
  throw new Error("Unexpected provider request");
}
