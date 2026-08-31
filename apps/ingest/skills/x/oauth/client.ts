import { parseXTimelinePage, XTimelinePayloadError, type XApiTimelinePage } from "./timeline.ts";

const DEFAULT_MAX_JSON_BYTES = 8 * 1_024 * 1_024;
const DEFAULT_MAX_TOKEN_BYTES = 64 * 1_024;
const MAX_REDIRECTS = 3;
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
  "note_tweet",
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
    try {
      return parseXTimelinePage(await readJson(response, this.#maxJsonBytes, signal));
    } catch (error) {
      if (error instanceof XTimelinePayloadError) {
        if (error.kind === "provider_rejected") {
          throw new XApiClientError(
            "provider_rejected",
            "X returned an incomplete timeline response",
          );
        }
        throw invalidResponse(error.message);
      }
      throw error;
    }
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
