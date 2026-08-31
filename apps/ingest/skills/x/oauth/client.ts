const DEFAULT_MAX_JSON_BYTES = 8 * 1_024 * 1_024;
const DEFAULT_MAX_TOKEN_BYTES = 64 * 1_024;
const MAX_REDIRECTS = 3;
const MAX_TIMELINE_POSTS = 100;
const MAX_TIMELINE_MEDIA = 400;
const MAX_POST_ENTITIES = 1_024;
const DECIMAL_ID = /^[0-9]{1,19}$/;
const HEADER_TOKEN = /^[\x21-\x7e]{1,16384}$/u;
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/u;

export const X_PROVIDER_ENDPOINTS = Object.freeze({
  authorization: "https://x.com/i/oauth2/authorize",
  token: "https://api.x.com/2/oauth2/token",
  revoke: "https://api.x.com/2/oauth2/revoke",
  apiBase: "https://api.x.com/2",
});

export const X_MEDIA_HOSTS = Object.freeze(["pbs.twimg.com", "video.twimg.com"] as const);

export const X_TIMELINE_TWEET_FIELDS = Object.freeze([
  "attachments",
  "author_id",
  "conversation_id",
  "created_at",
  "edit_history_tweet_ids",
  "entities",
  "lang",
  "possibly_sensitive",
  "referenced_tweets",
] as const);
export const X_TIMELINE_EXPANSIONS = Object.freeze(["attachments.media_keys"] as const);
export const X_TIMELINE_MEDIA_FIELDS = Object.freeze([
  "alt_text",
  "type",
  "url",
  "variants",
] as const);

export type XFetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface XProviderEndpoints {
  readonly authorization: string;
  readonly token: string;
  readonly revoke: string;
  readonly apiBase: string;
}

export interface XApiClientOptions {
  readonly fetch?: XFetchLike;
  readonly endpoints?: Partial<XProviderEndpoints>;
  readonly mediaHosts?: readonly string[];
  readonly maxJsonBytes?: number;
}

export type XApiClientErrorKind =
  | "invalid_response"
  | "provider_rejected"
  | "provider_unavailable"
  | "rate_limited"
  | "response_too_large"
  | "token_rejected"
  | "unauthorized"
  | "unsafe_endpoint";

/** Contains provider-safe classifications only; response bodies and credentials are never retained. */
export class XApiClientError extends Error {
  constructor(
    readonly kind: XApiClientErrorKind,
    message: string,
    readonly evidence: {
      readonly httpStatus?: number;
      readonly retryAfterSeconds?: number;
      readonly rateLimitResetEpoch?: number;
      readonly declaredByteSize?: number;
    } = {},
  ) {
    super(message);
    this.name = "XApiClientError";
  }
}

export interface XApiTokenResponse {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly tokenType: "bearer";
  readonly expiresInSeconds?: number;
  readonly scopes?: readonly string[];
}

export interface XApiUser {
  readonly id: string;
  readonly username: string;
  readonly name: string;
}

export type XApiPostReferenceType = "replied_to" | "quoted" | "retweeted";

export interface XApiPost {
  readonly id: string;
  readonly text: string;
  readonly author_id: string;
  readonly created_at: string;
  readonly conversation_id?: string;
  readonly referenced_tweets?: readonly {
    readonly type: XApiPostReferenceType;
    readonly id: string;
  }[];
  readonly attachments?: { readonly media_keys: readonly string[] };
  readonly lang?: string;
  readonly possibly_sensitive?: boolean;
  readonly edit_history_tweet_ids?: readonly string[];
  readonly entities?: {
    readonly urls?: readonly {
      readonly start?: number;
      readonly end?: number;
      readonly url: string;
      readonly expanded_url?: string;
    }[];
    readonly mentions?: readonly {
      readonly start?: number;
      readonly end?: number;
      readonly username: string;
    }[];
    readonly hashtags?: readonly {
      readonly start?: number;
      readonly end?: number;
      readonly tag: string;
    }[];
    readonly cashtags?: readonly {
      readonly start?: number;
      readonly end?: number;
      readonly tag: string;
    }[];
  };
}

export interface XApiMediaVariant {
  readonly content_type: string;
  readonly url: string;
  readonly bit_rate?: number;
}

export interface XApiMedia {
  readonly media_key: string;
  readonly type: "photo" | "video" | "animated_gif" | string;
  readonly url?: string;
  readonly alt_text?: string;
  readonly variants?: readonly XApiMediaVariant[];
}

export interface XApiTimelinePage {
  readonly data: readonly XApiPost[];
  readonly includes: { readonly media: readonly XApiMedia[] };
  readonly meta: {
    readonly result_count: number;
    readonly newest_id?: string;
    readonly oldest_id?: string;
    readonly next_token?: string;
  };
}

export interface XTokenRequestClient {
  readonly clientId: string;
  readonly clientSecret?: string;
}

export interface XTimelineRequest {
  readonly startTime?: string;
}

export class XApiClient {
  readonly endpoints: XProviderEndpoints;
  readonly #fetch: XFetchLike;
  readonly #mediaHosts: ReadonlySet<string>;
  readonly #maxJsonBytes: number;

  constructor(options: XApiClientOptions = {}) {
    this.endpoints = validatedEndpoints({ ...X_PROVIDER_ENDPOINTS, ...options.endpoints });
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#mediaHosts = new Set(
      (options.mediaHosts ?? X_MEDIA_HOSTS).map((host) => exactHostname(host, "X media host")),
    );
    if (this.#mediaHosts.size === 0) throw new Error("At least one X media host is required");
    this.#maxJsonBytes = options.maxJsonBytes ?? DEFAULT_MAX_JSON_BYTES;
    if (!positiveSafeInteger(this.#maxJsonBytes)) {
      throw new Error("X maxJsonBytes must be a positive safe integer");
    }
  }

  async exchangeAuthorizationCode(
    client: XTokenRequestClient,
    input: {
      readonly callbackUrl: string;
      readonly code: string;
      readonly codeVerifier: string;
      readonly signal: AbortSignal;
    },
  ): Promise<XApiTokenResponse> {
    assertFormCredential(input.code, "X authorization code", 8_192);
    assertFormCredential(input.codeVerifier, "X PKCE verifier", 512);
    return this.#tokenRequest(
      client,
      new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.callbackUrl,
        code_verifier: input.codeVerifier,
      }),
      input.signal,
    );
  }

  async refreshAccessToken(
    client: XTokenRequestClient,
    refreshToken: string,
    signal: AbortSignal,
  ): Promise<XApiTokenResponse> {
    assertFormCredential(refreshToken, "X refresh token", 16_384);
    return this.#tokenRequest(
      client,
      new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
      signal,
    );
  }

  async revokeToken(
    client: XTokenRequestClient,
    token: string,
    signal: AbortSignal,
  ): Promise<void> {
    assertFormCredential(token, "X revocation token", 16_384);
    const body = new URLSearchParams({ token });
    const headers = tokenRequestHeaders(client, body);
    const response = await this.#request(this.endpoints.revoke, {
      method: "POST",
      redirect: "error",
      headers,
      body,
      signal,
    });
    assertProviderStatus(response);
    await response.body?.cancel();
  }

  async getAuthenticatedUser(accessToken: string, signal: AbortSignal): Promise<XApiUser> {
    const response = await this.#apiRequest(
      `${this.endpoints.apiBase}/users/me`,
      accessToken,
      signal,
    );
    const value = await readJson(response, this.#maxJsonBytes, signal);
    if (!record(value) || providerErrorsPresent(value) || !record(value.data))
      throw invalidResponse("X identity response is invalid");
    return parseUser(value.data);
  }

  async getUserTimeline(
    accessToken: string,
    accountId: string,
    request: XTimelineRequest,
    signal: AbortSignal,
  ): Promise<XApiTimelinePage> {
    if (!DECIMAL_ID.test(accountId)) throw new Error("X timeline account id is invalid");
    const url = new URL(`${this.endpoints.apiBase}/users/${encodeURIComponent(accountId)}/tweets`);
    url.searchParams.set("max_results", "100");
    url.searchParams.set("exclude", "replies,retweets");
    url.searchParams.set("tweet.fields", X_TIMELINE_TWEET_FIELDS.join(","));
    url.searchParams.set("expansions", X_TIMELINE_EXPANSIONS.join(","));
    url.searchParams.set("media.fields", X_TIMELINE_MEDIA_FIELDS.join(","));
    if (request.startTime !== undefined) {
      const time = new Date(request.startTime);
      if (!Number.isFinite(time.getTime()) || time.toISOString() !== request.startTime) {
        throw new Error("X timeline start time is invalid");
      }
      url.searchParams.set("start_time", request.startTime);
    }
    const response = await this.#apiRequest(url, accessToken, signal);
    return parseTimelinePage(await readJson(response, this.#maxJsonBytes, signal));
  }

  async fetchMedia(
    sourceUrl: string,
    input: { readonly maximumBytes: number; readonly signal: AbortSignal },
  ): Promise<{ readonly bytes: Uint8Array; readonly mime?: string }> {
    if (!positiveSafeInteger(input.maximumBytes)) {
      throw new Error("X media byte limit must be a positive safe integer");
    }
    let endpoint = this.#safeMediaUrl(sourceUrl);
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await this.#request(endpoint, {
        method: "GET",
        redirect: "manual",
        headers: { Accept: "image/*,video/mp4" },
        signal: input.signal,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("Location");
        if (!location || redirects === MAX_REDIRECTS) {
          throw new XApiClientError(
            "unsafe_endpoint",
            "X media returned too many or malformed redirects",
          );
        }
        endpoint = this.#safeMediaUrl(new URL(location, endpoint).toString());
        continue;
      }
      assertProviderStatus(response);
      const bytes = await readBoundedBytes(
        response,
        input.maximumBytes,
        input.signal,
        "X media exceeded the configured element limit",
      );
      return {
        bytes,
        ...(mediaType(response.headers.get("Content-Type"))
          ? { mime: mediaType(response.headers.get("Content-Type")) }
          : {}),
      };
    }
    throw new XApiClientError("unsafe_endpoint", "X media redirect handling failed");
  }

  async #tokenRequest(
    client: XTokenRequestClient,
    body: URLSearchParams,
    signal: AbortSignal,
  ): Promise<XApiTokenResponse> {
    const headers = tokenRequestHeaders(client, body);
    const response = await this.#request(this.endpoints.token, {
      method: "POST",
      redirect: "error",
      headers,
      body,
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        throw new XApiClientError("token_rejected", "X rejected the authorization token", {
          httpStatus: response.status,
        });
      }
      throw statusError(response);
    }
    return parseTokenResponse(await readJson(response, DEFAULT_MAX_TOKEN_BYTES, signal));
  }

  async #apiRequest(
    endpoint: string | URL,
    accessToken: string,
    signal: AbortSignal,
  ): Promise<Response> {
    const response = await this.#request(endpoint, {
      method: "GET",
      redirect: "error",
      headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
      signal,
    });
    assertProviderStatus(response);
    return response;
  }

  async #request(endpoint: string | URL, init: RequestInit): Promise<Response> {
    try {
      return await this.#fetch(endpoint, init);
    } catch (error) {
      if (init.signal?.aborted) throw init.signal.reason;
      throw new XApiClientError("provider_unavailable", "X could not be reached");
    }
  }

  #safeMediaUrl(value: string): URL {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new XApiClientError("unsafe_endpoint", "X returned an invalid media URL");
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !this.#mediaHosts.has(url.hostname.toLowerCase())
    ) {
      throw new XApiClientError("unsafe_endpoint", "X returned an unsafe media URL");
    }
    return url;
  }
}

function tokenRequestHeaders(
  client: XTokenRequestClient,
  body: URLSearchParams,
): Record<string, string> {
  if (!/^[\x21-\x7e]{1,512}$/u.test(client.clientId) || client.clientId.includes(":"))
    throw new Error("X OAuth client id is invalid");
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (client.clientSecret !== undefined) {
    if (!/^[\x21-\x7e]{1,4096}$/u.test(client.clientSecret)) {
      throw new Error("X OAuth client secret is invalid");
    }
    headers.Authorization = `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64")}`;
  } else {
    body.set("client_id", client.clientId);
  }
  return headers;
}

function validatedEndpoints(endpoints: XProviderEndpoints): XProviderEndpoints {
  const validated = Object.fromEntries(
    Object.entries(endpoints).map(([name, value]) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new Error(`X ${name} endpoint is invalid`);
      }
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        url.search ||
        url.hash
      ) {
        throw new Error(`X ${name} endpoint must be an absolute default-port HTTPS URL`);
      }
      return [name, url.toString().replace(/\/$/u, "")];
    }),
  ) as unknown as XProviderEndpoints;
  return Object.freeze(validated);
}

function exactHostname(value: string, label: string): string {
  const hostname = value.trim().toLowerCase();
  if (!hostname || hostname.includes(":") || hostname.includes("/") || hostname.includes("*")) {
    throw new Error(`${label} must be an exact hostname`);
  }
  return hostname;
}

function assertProviderStatus(response: Response): void {
  if (!response.ok) {
    void response.body?.cancel();
    throw statusError(response);
  }
}

function statusError(response: Response): XApiClientError {
  if (response.status === 401 || response.status === 403) {
    return new XApiClientError("unauthorized", "X authorization is invalid or expired", {
      httpStatus: response.status,
    });
  }
  if (response.status === 429) {
    return new XApiClientError("rate_limited", "X request rate limit was reached", {
      httpStatus: response.status,
      ...(boundedHeaderInteger(response.headers.get("Retry-After")) !== undefined
        ? { retryAfterSeconds: boundedHeaderInteger(response.headers.get("Retry-After")) }
        : {}),
      ...(boundedHeaderInteger(response.headers.get("x-rate-limit-reset")) !== undefined
        ? { rateLimitResetEpoch: boundedHeaderInteger(response.headers.get("x-rate-limit-reset")) }
        : {}),
    });
  }
  return new XApiClientError("provider_rejected", "X rejected the provider request", {
    httpStatus: response.status,
  });
}

async function readJson(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<unknown> {
  const bytes = await readBoundedBytes(
    response,
    maximumBytes,
    signal,
    "X response exceeded its configured size limit",
  );
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text);
  } catch {
    throw invalidResponse("X returned malformed JSON");
  }
}

async function readBoundedBytes(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal,
  message: string,
): Promise<Uint8Array> {
  const contentLength = boundedHeaderInteger(response.headers.get("Content-Length"));
  if (contentLength !== undefined && contentLength > maximumBytes) {
    await response.body?.cancel();
    throw new XApiClientError("response_too_large", message, {
      declaredByteSize: contentLength,
    });
  }
  if (!response.body) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  const cancel = () => void reader.cancel(signal.reason);
  signal.addEventListener("abort", cancel, { once: true });
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        throw new XApiClientError("response_too_large", message);
      }
      chunks.push(value);
    }
    if (signal.aborted) throw signal.reason;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseTokenResponse(value: unknown): XApiTokenResponse {
  if (!record(value) || providerErrorsPresent(value)) {
    throw invalidResponse("X token response is invalid");
  }
  const accessToken =
    typeof value.access_token === "string" && HEADER_TOKEN.test(value.access_token)
      ? value.access_token
      : undefined;
  const tokenType = typeof value.token_type === "string" ? value.token_type.toLowerCase() : "";
  if (!accessToken || tokenType !== "bearer") throw invalidResponse("X token response is invalid");
  const refreshToken = optionalResponseString(value.refresh_token, "X refresh token", 1, 16_384);
  if (refreshToken !== undefined && !HEADER_TOKEN.test(refreshToken)) {
    throw invalidResponse("X refresh token is invalid");
  }
  const expiresInSeconds = optionalResponsePositiveInteger(
    value.expires_in,
    "X token expiry",
    31_536_000,
  );
  const scope = optionalResponseString(value.scope, "X token scope", 1, 4_096);
  return {
    accessToken,
    tokenType: "bearer",
    ...(refreshToken ? { refreshToken } : {}),
    ...(expiresInSeconds ? { expiresInSeconds } : {}),
    ...(scope ? { scopes: scope.split(/\s+/u).filter(Boolean) } : {}),
  };
}

function parseUser(value: Record<string, unknown>): XApiUser {
  if (!DECIMAL_ID.test(String(value.id ?? ""))) throw invalidResponse("X identity is invalid");
  const username = typeof value.username === "string" ? value.username : undefined;
  const name = typeof value.name === "string" ? value.name : undefined;
  if (
    !username ||
    !X_HANDLE.test(username) ||
    name === undefined ||
    Buffer.byteLength(name) > 256 ||
    /[\u0000-\u001f\u007f]/u.test(name)
  ) {
    throw invalidResponse("X identity is invalid");
  }
  return { id: String(value.id), username, name };
}

function parseTimelinePage(value: unknown): XApiTimelinePage {
  if (!record(value)) throw invalidResponse("X timeline response is invalid");
  if (value.error !== undefined) {
    throw new XApiClientError("provider_rejected", "X returned an incomplete timeline response");
  }
  if (value.errors !== undefined) {
    if (!Array.isArray(value.errors)) throw invalidResponse("X timeline errors are invalid");
    if (value.errors.length > 0) {
      throw new XApiClientError("provider_rejected", "X returned an incomplete timeline response");
    }
  }
  const data = value.data === undefined ? [] : value.data;
  if (!Array.isArray(data)) throw invalidResponse("X timeline data is invalid");
  if (data.length > MAX_TIMELINE_POSTS) {
    throw invalidResponse("X timeline exceeds the one-page product cap");
  }
  const posts = data.map(parsePost);
  const includes = value.includes === undefined ? {} : value.includes;
  if (!record(includes)) throw invalidResponse("X timeline includes are invalid");
  const rawMedia = includes.media === undefined ? [] : includes.media;
  if (!Array.isArray(rawMedia)) throw invalidResponse("X timeline media includes are invalid");
  if (rawMedia.length > MAX_TIMELINE_MEDIA) {
    throw invalidResponse("X timeline has too many media expansions");
  }
  const media = rawMedia.map(parseMedia);
  const meta = value.meta;
  if (!record(meta) || !nonnegativeInteger(meta.result_count)) {
    throw invalidResponse("X timeline result count is invalid");
  }
  const resultCount = meta.result_count;
  if (resultCount !== posts.length) {
    throw invalidResponse("X timeline result count is invalid");
  }
  const newestId = optionalResponseDecimal(meta.newest_id, "X timeline newest id");
  const oldestId = optionalResponseDecimal(meta.oldest_id, "X timeline oldest id");
  const nextToken = optionalResponseString(
    meta.next_token,
    "X timeline pagination token",
    1,
    1_024,
  );
  return {
    data: posts,
    includes: { media },
    meta: {
      result_count: resultCount,
      ...(newestId ? { newest_id: newestId } : {}),
      ...(oldestId ? { oldest_id: oldestId } : {}),
      ...(nextToken ? { next_token: nextToken } : {}),
    },
  };
}

function parsePost(value: unknown, index: number): XApiPost {
  if (!record(value)) throw invalidResponse(`X timeline post ${index} is invalid`);
  const id = requiredDecimal(value.id, `X timeline post ${index} id`);
  const authorId = requiredDecimal(value.author_id, `X timeline post ${id} author`);
  const text = boundedString(value.text, 1, 1_000_000);
  const createdAt = optionalDateTime(value.created_at);
  if (!text || !createdAt) throw invalidResponse(`X timeline post ${id} is incomplete`);

  let references: XApiPost["referenced_tweets"];
  if (value.referenced_tweets !== undefined) {
    if (!Array.isArray(value.referenced_tweets)) {
      throw invalidResponse(`X timeline post ${id} references are invalid`);
    }
    if (value.referenced_tweets.length > 3) {
      throw invalidResponse(`X timeline post ${id} has too many references`);
    }
    references = value.referenced_tweets.map((reference) => {
      if (
        !record(reference) ||
        !["replied_to", "quoted", "retweeted"].includes(String(reference.type))
      ) {
        throw invalidResponse(`X timeline post ${id} reference is invalid`);
      }
      return {
        type: reference.type as XApiPostReferenceType,
        id: requiredDecimal(reference.id, `X timeline post ${id} reference id`),
      };
    });
  }

  let attachments: XApiPost["attachments"];
  if (value.attachments !== undefined) {
    if (!record(value.attachments) || !Array.isArray(value.attachments.media_keys)) {
      throw invalidResponse(`X timeline post ${id} attachments are invalid`);
    }
    if (value.attachments.media_keys.length > 4) {
      throw invalidResponse(`X timeline post ${id} has too many attachments`);
    }
    attachments = {
      media_keys: value.attachments.media_keys.map((key) => {
        const mediaKey = boundedString(key, 1, 256);
        if (!mediaKey) throw invalidResponse(`X timeline post ${id} media key is invalid`);
        return mediaKey;
      }),
    };
  }
  const editIds = value.edit_history_tweet_ids;
  if (editIds !== undefined && !Array.isArray(editIds)) {
    throw invalidResponse(`X timeline post ${id} edit history is invalid`);
  }
  if (Array.isArray(editIds) && editIds.length > 100) {
    throw invalidResponse(`X timeline post ${id} edit history is too large`);
  }
  const entities = value.entities === undefined ? undefined : parsePostEntities(value.entities, id);
  const conversationId = optionalResponseDecimal(
    value.conversation_id,
    `X timeline post ${id} conversation id`,
  );
  const lang = optionalResponseString(value.lang, `X timeline post ${id} language`, 1, 35);
  if (value.possibly_sensitive !== undefined && typeof value.possibly_sensitive !== "boolean") {
    throw invalidResponse(`X timeline post ${id} sensitivity flag is invalid`);
  }
  return {
    id,
    text,
    author_id: authorId,
    created_at: createdAt,
    ...(conversationId ? { conversation_id: conversationId } : {}),
    ...(references ? { referenced_tweets: references } : {}),
    ...(attachments ? { attachments } : {}),
    ...(lang ? { lang } : {}),
    ...(typeof value.possibly_sensitive === "boolean"
      ? { possibly_sensitive: value.possibly_sensitive }
      : {}),
    ...(editIds
      ? {
          edit_history_tweet_ids: editIds.map((editId) =>
            requiredDecimal(editId, `X timeline post ${id} edit id`),
          ),
        }
      : {}),
    ...(entities ? { entities } : {}),
  };
}

function parseMedia(value: unknown, index: number): XApiMedia {
  if (!record(value)) throw invalidResponse(`X timeline media ${index} is invalid`);
  const mediaKey = boundedString(value.media_key, 1, 256);
  const type = boundedString(value.type, 1, 64);
  if (!mediaKey || !type) throw invalidResponse(`X timeline media ${index} is invalid`);
  let variants: XApiMediaVariant[] | undefined;
  if (value.variants !== undefined) {
    if (!Array.isArray(value.variants)) {
      throw invalidResponse(`X timeline media ${mediaKey} variants are invalid`);
    }
    if (value.variants.length > 100) {
      throw invalidResponse(`X timeline media ${mediaKey} has too many variants`);
    }
    variants = value.variants.map((variant) => {
      if (!record(variant)) {
        throw invalidResponse(`X timeline media ${mediaKey} variant is invalid`);
      }
      const contentType = boundedString(variant.content_type, 1, 128);
      const url = boundedString(variant.url, 1, 8_192);
      if (!contentType || !url) {
        throw invalidResponse(`X timeline media ${mediaKey} variant is invalid`);
      }
      const bitRate = optionalNonnegativeInteger(variant.bit_rate, 10_000_000_000);
      if (variant.bit_rate !== undefined && bitRate === undefined) {
        throw invalidResponse(`X timeline media ${mediaKey} variant bit rate is invalid`);
      }
      return {
        content_type: contentType,
        url,
        ...(bitRate !== undefined ? { bit_rate: bitRate } : {}),
      };
    });
  }
  const url = optionalResponseString(value.url, `X timeline media ${mediaKey} URL`, 1, 8_192);
  const alt = optionalResponseString(
    value.alt_text,
    `X timeline media ${mediaKey} alt text`,
    0,
    8_192,
  );
  return {
    media_key: mediaKey,
    type,
    ...(url ? { url } : {}),
    ...(alt !== undefined ? { alt_text: alt } : {}),
    ...(variants ? { variants } : {}),
  };
}

function parsePostEntities(value: unknown, postId: string): NonNullable<XApiPost["entities"]> {
  if (!record(value)) throw invalidResponse(`X timeline post ${postId} entities are invalid`);
  const urls = providerEntityArray(value, "urls", postId);
  const mentions = providerEntityArray(value, "mentions", postId);
  const hashtags = providerEntityArray(value, "hashtags", postId);
  const cashtags = providerEntityArray(value, "cashtags", postId);
  if (urls.length + mentions.length + hashtags.length + cashtags.length > MAX_POST_ENTITIES) {
    throw invalidResponse(`X timeline post ${postId} has too many structured entities`);
  }
  return {
    ...(urls.length
      ? {
          urls: urls.map((entity, index) => {
            if (!record(entity)) {
              throw invalidResponse(`X timeline post ${postId} URL entity ${index} is invalid`);
            }
            const url = boundedString(entity.url, 1, 8_192);
            const expandedUrl = optionalResponseString(
              entity.expanded_url,
              `X timeline post ${postId} expanded URL entity`,
              1,
              8_192,
            );
            if (!url) {
              throw invalidResponse(`X timeline post ${postId} URL entity ${index} is invalid`);
            }
            return {
              url,
              ...(expandedUrl ? { expanded_url: expandedUrl } : {}),
              ...providerEntitySpan(entity, postId, "URL", index),
            };
          }),
        }
      : {}),
    ...(mentions.length
      ? {
          mentions: mentions.map((entity, index) => {
            if (!record(entity)) {
              throw invalidResponse(`X timeline post ${postId} mention ${index} is invalid`);
            }
            const username = boundedString(entity.username, 1, 64);
            if (!username) {
              throw invalidResponse(`X timeline post ${postId} mention ${index} is invalid`);
            }
            return {
              username,
              ...providerEntitySpan(entity, postId, "mention", index),
            };
          }),
        }
      : {}),
    ...(hashtags.length
      ? {
          hashtags: hashtags.map((entity, index) =>
            parseProviderTagEntity(entity, postId, "hashtag", index),
          ),
        }
      : {}),
    ...(cashtags.length
      ? {
          cashtags: cashtags.map((entity, index) =>
            parseProviderTagEntity(entity, postId, "cashtag", index),
          ),
        }
      : {}),
  };
}

function providerEntityArray(
  entities: Readonly<Record<string, unknown>>,
  key: string,
  postId: string,
): readonly unknown[] {
  const value = entities[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw invalidResponse(`X timeline post ${postId} ${key} entities are invalid`);
  }
  return value;
}

function providerEntitySpan(
  entity: Readonly<Record<string, unknown>>,
  postId: string,
  label: string,
  index: number,
): { readonly start?: number; readonly end?: number } {
  const start = optionalNonnegativeInteger(entity.start, 1_000_000);
  const end = optionalNonnegativeInteger(entity.end, 1_000_000);
  if (
    (entity.start === undefined) !== (entity.end === undefined) ||
    (entity.start !== undefined && (start === undefined || end === undefined || end <= start))
  ) {
    throw invalidResponse(`X timeline post ${postId} ${label} entity ${index} is invalid`);
  }
  return start !== undefined && end !== undefined ? { start, end } : {};
}

function parseProviderTagEntity(
  entity: unknown,
  postId: string,
  label: "hashtag" | "cashtag",
  index: number,
) {
  if (!record(entity)) {
    throw invalidResponse(`X timeline post ${postId} ${label} entity ${index} is invalid`);
  }
  const tag = boundedString(entity.tag, 1, 256);
  if (!tag) {
    throw invalidResponse(`X timeline post ${postId} ${label} entity ${index} is invalid`);
  }
  return {
    tag,
    ...providerEntitySpan(entity, postId, label, index),
  };
}

function mediaType(value: string | null): string | undefined {
  const mime = value?.split(";", 1)[0]?.trim().toLowerCase();
  return mime && mime.length <= 128 ? mime : undefined;
}

function invalidResponse(message: string): XApiClientError {
  return new XApiClientError("invalid_response", message);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function providerErrorsPresent(value: Record<string, unknown>): boolean {
  return (
    value.error !== undefined ||
    (value.errors !== undefined && (!Array.isArray(value.errors) || value.errors.length > 0))
  );
}

function boundedString(value: unknown, minimum: number, maximum: number): string | undefined {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum
    ? value
    : undefined;
}

function requiredDecimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !DECIMAL_ID.test(value))
    throw invalidResponse(`${label} is invalid`);
  return value;
}

function optionalResponseDecimal(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !DECIMAL_ID.test(value))
    throw invalidResponse(`${label} is invalid`);
  return value;
}

function optionalDateTime(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function optionalResponseString(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): string | undefined {
  if (value === undefined) return undefined;
  const parsed = boundedString(value, minimum, maximum);
  if (parsed === undefined) throw invalidResponse(`${label} is invalid`);
  return parsed;
}

function optionalResponsePositiveInteger(
  value: unknown,
  label: string,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > maximum) {
    throw invalidResponse(`${label} is invalid`);
  }
  return Number(value);
}

function optionalNonnegativeInteger(value: unknown, maximum: number): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum
    ? Number(value)
    : undefined;
}

function boundedHeaderInteger(value: string | null): number | undefined {
  if (!value || !/^[0-9]{1,16}$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function assertFormCredential(value: string, label: string, maximum: number): void {
  if (!value || value.length > maximum || !/^[\x21-\x7e]+$/u.test(value)) {
    throw new Error(`${label} is invalid`);
  }
}
