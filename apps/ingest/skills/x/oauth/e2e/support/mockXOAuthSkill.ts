import type { MediaElement, MediaObject } from "@rnet/types";

import {
  OWNER_ID,
  type MockSourceSkillAdapter,
  type MockStagedElement,
} from "@rhizome/test-support/mockStore";
import type { XVerifyReport } from "../../../contracts.ts";
import type { XFetchLike } from "../../client.ts";
import { serializeXOAuthSecret } from "../../oauth.ts";
import { createXOAuthSkill } from "../../source.ts";

export const X_OAUTH_AUTHORIZATION_CODE = "x-mock-authorization-code-browser-only";
export const X_OAUTH_ACCESS_TOKEN = "x-mock-server-only-access-token";

const X_OAUTH_SOURCE_ID = "0198f2a1-2a01-7a01-8a01-000000000001";
const X_OAUTH_OPERATION_ID = "0198f2a1-2b01-7b01-8b01-000000000001";
const X_OAUTH_CREDENTIAL_ID = "0198f2a1-2c01-7c01-8c01-000000000001";
const X_OAUTH_ORIGIN_NAMESPACE = "0198f2a1-2d01-7d01-8d01";
export const X_OAUTH_AUTHORIZATION_ENDPOINT = "https://x-oauth.mock.invalid/i/oauth2/authorize";
const X_OAUTH_API_BASE = "https://api.x-oauth.mock.invalid/2";
const RETRIEVED_AT = "2026-08-22T12:00:00.000Z";
const ACCOUNT = { id: "42", handle: "example_user", name: "Example User" } as const;

export interface MockXProviderCall {
  readonly operation: "identity" | "timeline" | "image" | "video";
  readonly url: string;
  readonly authorization?: string;
}

export interface MockXProvider {
  readonly calls: readonly MockXProviderCall[];
}

export function createMockXOAuthSkill(): {
  readonly adapter: MockSourceSkillAdapter;
  readonly provider: MockXProvider;
} {
  const provider = new InMemoryXProvider();
  const skill = createXOAuthSkill(
    { clientId: "x-oauth-mock-client", budgetEnabled: true },
    {
      fetch: provider.fetch,
      endpoints: { apiBase: X_OAUTH_API_BASE },
      now: () => new Date(RETRIEVED_AT),
    },
  );
  const secret = serializeXOAuthSecret({
    accessToken: X_OAUTH_ACCESS_TOKEN,
    refreshToken: "x-mock-server-only-refresh-token",
    expiresAtEpoch: 1_788_000_000,
    account: ACCOUNT,
  });
  const adapter = {
    credentialId: X_OAUTH_CREDENTIAL_ID,
    manifest: skill.manifest,
    operationId: X_OAUTH_OPERATION_ID,
    sourceId: X_OAUTH_SOURCE_ID,
    oauth: {
      authorizationEndpoint: X_OAUTH_AUTHORIZATION_ENDPOINT,
      authorizationCode: X_OAUTH_AUTHORIZATION_CODE,
    },
    async capture(context) {
      const prepared = await skill.prepareFetch({
        config: {},
        endDateEpoch: 1_788_000_000,
        limits: skill.manifest.limits,
      });
      const payload = await prepared.retrieve(secret, { signal: new AbortController().signal });
      const sequence = context.nextSequence(skill.skillId);
      const id = `${X_OAUTH_ORIGIN_NAMESPACE}-${String(sequence).padStart(12, "0")}`;
      return context.save({
        id,
        payload,
        contentHash: `sha256:${String(sequence).padStart(64, "7")}`,
        label: skill.capture.label(id),
        mime: skill.capture.mime,
      });
    },
    normalizeConfig(input) {
      return input === undefined
        ? { ok: true, value: {} }
        : { ok: false, detail: "X OAuth source configuration must be omitted" };
    },
    async stage({ origin }) {
      const prepared = await skill.prepareFetch({
        config: {},
        endDateEpoch: 1_788_000_000,
        limits: skill.manifest.limits,
      });
      const bundle = await prepared.compiledSource.compile({
        bytes: origin.payload,
        limits: skill.manifest.limits,
      });
      const verify = bundle.verify as unknown as XVerifyReport;
      const candidates: MediaObject[] = [];
      const elements: MockStagedElement[] = [];
      for (const [candidateIndex, candidate] of bundle.candidates.entries()) {
        const objectId = indexedUuid("0198f2a1-2e01-7e01-8e01-000000000000", candidateIndex);
        const objectUri = `rnet://object/${objectId}` as const;
        const references: MediaObject["elements"] = [];
        for (const [elementIndex, element] of candidate.elements.entries()) {
          const elementId = indexedUuid(
            "0198f2a1-2f01-7f01-8f01-000000000000",
            candidateIndex * 10 + elementIndex,
          );
          const uri = `rnet://element/${elementId}` as const;
          const document = {
            rnet_schema: "0.1",
            kind: element.kind,
            uri,
            owner: `rnet://id/${OWNER_ID}`,
            content_hash: element.contentHash,
            mime: element.mime,
            bytes: `http://127.0.0.1/rnet/v0/elements/${elementId}/bytes`,
            byte_size: element.byteSize,
            ...(element.alt ? { alt: element.alt } : {}),
            created_at: RETRIEVED_AT,
          } satisfies MediaElement;
          references.push({
            uri,
            role: element.role,
          });
          elements.push({
            document,
            object_uri: objectUri,
            preview_url: `/rnet/v0/operations/${X_OAUTH_OPERATION_ID}/elements/${elementId}/bytes`,
            role: element.role,
            ...(element.alt ? { alt: element.alt } : {}),
            payload: Buffer.from(element.bytes),
          });
        }
        candidates.push({
          rnet_schema: "0.1",
          uri: objectUri,
          owner: `rnet://id/${OWNER_ID}`,
          type: candidate.type,
          elements: references,
          keys: candidate.keys,
          source: {
            ingest: { method: "parser", reproducible: true, skill: "x-posts@0.0.0-test" },
            origins: [origin.document.uri],
            properties: candidate.sourceProperties,
          },
        });
      }
      return {
        candidates,
        destination: bundle.destination,
        elements,
        verification: {
          ...verify,
          checks: [...verify.checks],
          totals_by_currency: {},
        },
      };
    },
  } satisfies MockSourceSkillAdapter;
  return { adapter, provider };
}

class InMemoryXProvider implements MockXProvider {
  readonly #calls: MockXProviderCall[] = [];

  get calls(): readonly MockXProviderCall[] {
    return this.#calls;
  }

  readonly fetch: XFetchLike = async (input, init = {}) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const authorization = new Headers(init.headers).get("Authorization") ?? undefined;
    const method = init.method ?? "GET";

    if (url.href === `${X_OAUTH_API_BASE}/users/me`) {
      this.#record("identity", url, authorization);
      requireApiRequest(method, authorization);
      return json({ data: { id: ACCOUNT.id, username: ACCOUNT.handle, name: ACCOUNT.name } });
    }
    if (url.pathname === "/2/users/42/tweets" && url.origin === new URL(X_OAUTH_API_BASE).origin) {
      this.#record("timeline", url, authorization);
      requireApiRequest(method, authorization);
      requireTimelineQuery(url);
      return json(timelinePage());
    }
    if (url.href === "https://pbs.twimg.com/media/mock-horizon.jpg") {
      this.#record("image", url, authorization);
      requireMediaRequest(method, authorization);
      return new Response("mocked-image", {
        headers: { "Content-Type": "image/jpeg", "Content-Length": "12" },
      });
    }
    if (url.href === "https://video.twimg.com/ext_tw_video/mock/video.mp4") {
      this.#record("video", url, authorization);
      requireMediaRequest(method, authorization);
      return new Response("mocked-mp4", {
        headers: { "Content-Type": "video/mp4", "Content-Length": "10" },
      });
    }
    throw new Error(`Unexpected mocked X request: ${method} ${url.href}`);
  };

  #record(
    operation: MockXProviderCall["operation"],
    url: URL,
    authorization: string | undefined,
  ): void {
    this.#calls.push({ operation, url: url.href, ...(authorization ? { authorization } : {}) });
  }
}

function timelinePage() {
  const quoteText = "Mocked commentary https://t.co/quote";
  const quoteUrl = "https://t.co/quote";
  const quoteStart = [...quoteText.slice(0, quoteText.indexOf(quoteUrl))].length;
  return {
    data: [
      providerPost("205", "2026-08-21T10:00:00.000Z", "Newest post with a mocked image", {
        attachments: { media_keys: ["photo-205"] },
      }),
      providerPost("204", "2026-08-20T10:00:00.000Z", quoteText, {
        attachments: { media_keys: ["video-204"] },
        referenced_tweets: [{ type: "quoted", id: "170" }],
        entities: {
          urls: [
            {
              start: quoteStart,
              end: quoteStart + [...quoteUrl].length,
              url: quoteUrl,
              expanded_url: "https://x.com/quoted/status/170",
            },
          ],
        },
      }),
      providerPost("203", "2026-08-19T10:00:00.000Z", "Excluded reply", {
        referenced_tweets: [{ type: "replied_to", id: "160" }],
      }),
      providerPost("202", "2026-08-18T10:00:00.000Z", "Excluded repost", {
        referenced_tweets: [{ type: "retweeted", id: "150" }],
      }),
    ],
    includes: {
      media: [
        {
          media_key: "photo-205",
          type: "photo",
          url: "https://pbs.twimg.com/media/mock-horizon.jpg",
          alt_text: "A mocked horizon",
        },
        {
          media_key: "video-204",
          type: "video",
          variants: [
            {
              bit_rate: 832_000,
              content_type: "video/mp4",
              url: "https://video.twimg.com/ext_tw_video/mock/video.mp4",
            },
          ],
        },
      ],
    },
    meta: { result_count: 4, newest_id: "205", oldest_id: "202" },
  };
}

function providerPost(
  id: string,
  createdAt: string,
  text: string,
  extra: Readonly<Record<string, unknown>> = {},
) {
  return {
    id,
    text,
    author_id: ACCOUNT.id,
    created_at: createdAt,
    conversation_id: id,
    lang: "en",
    possibly_sensitive: false,
    edit_history_tweet_ids: [id],
    ...extra,
  };
}

function requireApiRequest(method: string, authorization: string | undefined): void {
  if (method !== "GET" || authorization !== `Bearer ${X_OAUTH_ACCESS_TOKEN}`) {
    throw new Error("Mock X API request did not preserve server-only bearer authorization");
  }
}

function requireMediaRequest(method: string, authorization: string | undefined): void {
  if (method !== "GET" || authorization !== undefined) {
    throw new Error("Mock X media request leaked provider authorization");
  }
}

function requireTimelineQuery(url: URL): void {
  if (
    url.searchParams.get("max_results") !== "100" ||
    url.searchParams.get("exclude") !== "replies,retweets" ||
    !url.searchParams.get("tweet.fields") ||
    url.searchParams.get("expansions") !== "attachments.media_keys" ||
    !url.searchParams.get("media.fields") ||
    url.searchParams.has("pagination_token")
  ) {
    throw new Error("Mock X timeline request did not use the bounded one-page contract");
  }
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
}

function indexedUuid(namespace: string, index: number): string {
  return `${namespace.slice(0, -12)}${String(index + 1).padStart(12, "0")}`;
}
