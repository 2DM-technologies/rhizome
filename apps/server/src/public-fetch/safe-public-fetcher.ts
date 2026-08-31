import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";

import { isSafePublicIpAddress } from "./ip-address.ts";

const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENT_REQUESTS = 8;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_CONFIGURED_BYTES = 2_147_483_647;
const MAX_CONFIGURED_CONCURRENCY = 128;
const MAX_CONFIGURED_REDIRECTS = 20;
const MAX_CONFIGURED_TIMEOUT_MS = 10 * 60_000;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// Public fetches never need caller-owned credentials. An allowlist also prevents a future caller
// from accidentally inventing a credential-bearing custom header that this boundary does not know
// to deny.
const ALLOWED_REQUEST_HEADERS = new Set([
  "accept",
  "accept-language",
  "cache-control",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "if-range",
  "pragma",
  "range",
  "user-agent",
]);

export type SafePublicFetchErrorKind =
  | "aborted"
  | "dns_failure"
  | "invalid_response"
  | "invalid_url"
  | "request_failed"
  | "request_timeout"
  | "response_too_large"
  | "too_many_redirects"
  | "unsafe_address";

export class SafePublicFetchError extends Error {
  constructor(
    readonly kind: SafePublicFetchErrorKind,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SafePublicFetchError";
  }
}

export interface ResolvedPublicAddress {
  address: string;
  family: 4 | 6;
}

export type SafePublicDnsResolver = (
  hostname: string,
  signal: AbortSignal,
) => Promise<readonly ResolvedPublicAddress[]>;

/** The fully validated request handed to a transport. */
export interface PinnedPublicRequest {
  /** The selected address. A production transport must connect to this exact value. */
  address: ResolvedPublicAddress;
  /** A server-sanitized, credential-free header set. */
  headers: Readonly<Record<string, string>>;
  /** Host header derived from the current redirect URL, never from caller headers. */
  hostHeader: string;
  signal: AbortSignal;
  /** Original DNS name for certificate verification and SNI. Absent for IP-literal URLs. */
  tlsServername?: string;
  url: URL;
}

export interface PublicTransportResponse {
  body: AsyncIterable<Uint8Array>;
  /** Immediately releases the response/socket when its body will not be consumed. */
  close?: () => void;
  headers: Headers;
  status: number;
}

export type SafePublicTransport = (
  request: PinnedPublicRequest,
) => Promise<PublicTransportResponse>;

export interface SafePublicFetcherOptions {
  maxBytes?: number;
  maxConcurrentRequests?: number;
  maxRedirects?: number;
  resolver?: SafePublicDnsResolver;
  timeoutMs?: number;
  transport?: SafePublicTransport;
}

export interface SafePublicFetchOptions {
  /** Only a small, credential-free allowlist is forwarded. */
  headers?: HeadersInit;
  /** Per-call limits may tighten, but never increase, the fetcher's server-owned policy. */
  maxBytes?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface SafePublicRedirect {
  fromUrl: string;
  location: string;
  status: number;
  toUrl: string;
}

export interface SafePublicFetchResult {
  bytes: Uint8Array;
  finalUrl: string;
  headers: Headers;
  redirects: readonly SafePublicRedirect[];
  requestedUrl: string;
  status: number;
}

/**
 * A server-owned public HTTPS/443 boundary with DNS rebinding and SSRF defenses.
 *
 * Each hop is resolved independently, every returned address must be public, and the chosen answer
 * is passed to a transport that pins the TCP connection while retaining the original TLS identity.
 */
export class SafePublicFetcher {
  readonly #maxBytes: number;
  readonly #maxRedirects: number;
  readonly #resolver: SafePublicDnsResolver;
  readonly #semaphore: Semaphore;
  readonly #timeoutMs: number;
  readonly #transport: SafePublicTransport;

  constructor(options: SafePublicFetcherOptions = {}) {
    this.#maxBytes = positiveInteger(
      options.maxBytes ?? DEFAULT_MAX_BYTES,
      "maxBytes",
      MAX_CONFIGURED_BYTES,
    );
    this.#maxRedirects = nonnegativeInteger(
      options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
      "maxRedirects",
      MAX_CONFIGURED_REDIRECTS,
    );
    this.#timeoutMs = positiveInteger(
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      "timeoutMs",
      MAX_CONFIGURED_TIMEOUT_MS,
    );
    const maxConcurrentRequests = positiveInteger(
      options.maxConcurrentRequests ?? DEFAULT_MAX_CONCURRENT_REQUESTS,
      "maxConcurrentRequests",
      MAX_CONFIGURED_CONCURRENCY,
    );
    this.#resolver = options.resolver ?? systemPublicDnsResolver;
    this.#transport = options.transport ?? pinnedNodeHttpsTransport;
    this.#semaphore = new Semaphore(maxConcurrentRequests);
  }

  async fetch(
    input: string | URL,
    options: SafePublicFetchOptions = {},
  ): Promise<SafePublicFetchResult> {
    const initialUrl = normalizePublicUrl(input);
    const maxBytes = tighteningPositiveInteger(options.maxBytes, this.#maxBytes, "maxBytes");
    const maxRedirects = tighteningNonnegativeInteger(
      options.maxRedirects,
      this.#maxRedirects,
      "maxRedirects",
    );
    const timeoutMs = tighteningPositiveInteger(options.timeoutMs, this.#timeoutMs, "timeoutMs");
    const headers = sanitizeRequestHeaders(options.headers);
    const requestScope = createRequestScope(timeoutMs, options.signal);

    try {
      const operation = this.#fetchAcrossRedirects(
        initialUrl,
        headers,
        maxBytes,
        maxRedirects,
        requestScope.signal,
      );
      return await Promise.race([operation, requestScope.termination]);
    } catch (error) {
      if (requestScope.terminalError !== undefined) throw requestScope.terminalError;
      if (error instanceof SafePublicFetchError) throw error;
      if (error instanceof AbortSignalError) {
        throw new SafePublicFetchError("aborted", "Public HTTPS request was aborted");
      }
      throw new SafePublicFetchError("request_failed", "Public HTTPS request failed", error);
    } finally {
      requestScope.dispose();
    }
  }

  async #fetchAcrossRedirects(
    initialUrl: URL,
    headers: Readonly<Record<string, string>>,
    maxBytes: number,
    maxRedirects: number,
    signal: AbortSignal,
  ): Promise<SafePublicFetchResult> {
    const requestedUrl = initialUrl.href;
    let currentUrl = initialUrl;
    const redirects: SafePublicRedirect[] = [];

    for (;;) {
      const release = await this.#semaphore.acquire(signal);
      let response: PublicTransportResponse | undefined;
      try {
        const address = await resolvePublicAddress(currentUrl, this.#resolver, signal);
        const hostname = hostnameFromUrl(currentUrl);
        const request: PinnedPublicRequest = {
          address,
          headers,
          hostHeader: currentUrl.host,
          signal,
          ...(isIP(hostname) === 0 ? { tlsServername: hostname } : {}),
          url: new URL(currentUrl),
        };
        try {
          response = await raceWithAbort(this.#transport(request), signal);
        } catch (error) {
          if (error instanceof AbortSignalError) throw error;
          throw new SafePublicFetchError("request_failed", "Public HTTPS request failed", error);
        }
        validateTransportResponse(response);

        if (REDIRECT_STATUSES.has(response.status)) {
          const location = response.headers.get("location");
          if (location === null) {
            throw new SafePublicFetchError(
              "invalid_response",
              "Public HTTPS redirect did not include a Location header",
            );
          }
          if (redirects.length >= maxRedirects) {
            throw new SafePublicFetchError(
              "too_many_redirects",
              "Public HTTPS request exceeded the redirect limit",
            );
          }
          let nextUrl: URL;
          try {
            nextUrl = normalizePublicUrl(new URL(location, currentUrl));
          } catch (error) {
            if (error instanceof SafePublicFetchError) throw error;
            throw new SafePublicFetchError(
              "invalid_response",
              "Public HTTPS redirect Location was invalid",
              error,
            );
          }
          redirects.push({
            fromUrl: currentUrl.href,
            location,
            status: response.status,
            toUrl: nextUrl.href,
          });
          response.close?.();
          response = undefined;
          currentUrl = nextUrl;
          continue;
        }

        const resultHeaders = new Headers(response.headers);
        const status = response.status;
        const bytes = await readBoundedBody(response, maxBytes, signal);
        response = undefined;
        return {
          bytes,
          finalUrl: currentUrl.href,
          headers: resultHeaders,
          redirects,
          requestedUrl,
          status,
        };
      } catch (error) {
        response?.close?.();
        throw error;
      } finally {
        release();
      }
    }
  }
}

/** Uses the OS resolver. The caller still validates every returned address before selection. */
export const systemPublicDnsResolver: SafePublicDnsResolver = async (hostname, signal) => {
  throwIfAborted(signal);
  const answers = await dnsLookup(hostname, { all: true, verbatim: true });
  throwIfAborted(signal);
  return answers.map(({ address, family }) => ({
    address,
    family: family === 6 ? 6 : 4,
  }));
};

/**
 * Node may request all-address results for connection-family selection. Both callback forms return
 * only the address already vetted by the fetcher, preserving the transport's pinning guarantee.
 * @internal Exposed for deterministic coverage of Node's two lookup callback contracts.
 */
export function createPinnedAddressLookup(address: ResolvedPublicAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all === true) {
      callback(null, [{ address: address.address, family: address.family }]);
      return;
    }
    callback(null, address.address, address.family);
  };
}

/**
 * Production transport: connect to the selected address with a one-shot agent while keeping the
 * original URL hostname for Host, TLS SNI, and certificate verification.
 */
export const pinnedNodeHttpsTransport: SafePublicTransport = (request) =>
  new Promise((resolve, reject) => {
    const hostname = hostnameFromUrl(request.url);
    const clientRequest = httpsRequest(
      {
        agent: false,
        family: request.address.family,
        headers: { ...request.headers, host: request.hostHeader },
        hostname,
        lookup: createPinnedAddressLookup(request.address),
        method: "GET",
        path: `${request.url.pathname}${request.url.search}`,
        port: request.url.port === "" ? 443 : Number(request.url.port),
        protocol: "https:",
        rejectUnauthorized: true,
        servername: request.tlsServername,
        signal: request.signal,
      },
      (incoming) => {
        resolve({
          body: nodeResponseBody(incoming),
          close: () => incoming.destroy(),
          headers: headersFromNodeResponse(incoming.headers),
          status: incoming.statusCode ?? 0,
        });
      },
    );
    clientRequest.once("error", reject);
    clientRequest.end();
  });

async function resolvePublicAddress(
  url: URL,
  resolver: SafePublicDnsResolver,
  signal: AbortSignal,
): Promise<ResolvedPublicAddress> {
  const hostname = hostnameFromUrl(url);
  const literalFamily = isIP(hostname);
  let answers: readonly ResolvedPublicAddress[];
  if (literalFamily === 4 || literalFamily === 6) {
    answers = [{ address: hostname, family: literalFamily }];
  } else {
    try {
      answers = await raceWithAbort(resolver(hostname, signal), signal);
    } catch (error) {
      if (error instanceof AbortSignalError) throw error;
      throw new SafePublicFetchError("dns_failure", "Public hostname resolution failed", error);
    }
  }
  if (answers.length === 0) {
    throw new SafePublicFetchError("dns_failure", "Public hostname returned no addresses");
  }

  const normalized: ResolvedPublicAddress[] = [];
  const seen = new Set<string>();
  for (const answer of answers) {
    const address = answer.address.trim();
    const actualFamily = isIP(address);
    if (
      (answer.family !== 4 && answer.family !== 6) ||
      actualFamily === 0 ||
      actualFamily !== answer.family
    ) {
      throw new SafePublicFetchError("dns_failure", "Public hostname returned an invalid address");
    }
    if (!isSafePublicIpAddress(address)) {
      throw new SafePublicFetchError(
        "unsafe_address",
        "Public hostname resolved outside the public address space",
      );
    }
    const key = `${answer.family}:${address}`;
    if (!seen.has(key)) {
      seen.add(key);
      normalized.push({ address, family: answer.family });
    }
  }
  const selected = normalized[0];
  if (selected === undefined) {
    throw new SafePublicFetchError("dns_failure", "Public hostname returned no addresses");
  }
  return selected;
}

async function readBoundedBody(
  response: PublicTransportResponse,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  assertIdentityContentEncoding(response.headers);
  const encodedLength = response.headers.get("content-length");
  if (encodedLength !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(encodedLength)) {
      throw new SafePublicFetchError(
        "invalid_response",
        "Public HTTPS response had an invalid Content-Length",
      );
    }
    if (BigInt(encodedLength) > BigInt(maxBytes)) {
      throw new SafePublicFetchError(
        "response_too_large",
        "Public HTTPS response exceeded the byte limit",
      );
    }
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const iterator = response.body[Symbol.asyncIterator]();
  try {
    for (;;) {
      const next = await raceWithAbort(iterator.next(), signal);
      if (next.done) break;
      const chunk = next.value;
      if (!(chunk instanceof Uint8Array)) {
        throw new SafePublicFetchError(
          "invalid_response",
          "Public HTTPS transport returned a non-binary body",
        );
      }
      if (chunk.byteLength > maxBytes - totalBytes) {
        throw new SafePublicFetchError(
          "response_too_large",
          "Public HTTPS response exceeded the byte limit",
        );
      }
      totalBytes += chunk.byteLength;
      chunks.push(Uint8Array.from(chunk));
    }
  } catch (error) {
    void iterator.return?.().catch(() => undefined);
    throw error;
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function assertIdentityContentEncoding(headers: Headers): void {
  const encoded = headers.get("content-encoding");
  if (encoded === null || encoded.trim() === "") return;
  if (encoded.trim().toLowerCase() !== "identity") {
    throw new SafePublicFetchError(
      "invalid_response",
      "Public HTTPS response used an unsupported Content-Encoding",
    );
  }
}

function normalizePublicUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = new URL(typeof input === "string" ? input : input.href);
  } catch (error) {
    throw new SafePublicFetchError("invalid_url", "Public fetch URL was invalid", error);
  }
  if (url.protocol !== "https:") {
    throw new SafePublicFetchError("invalid_url", "Public fetch URL must use HTTPS");
  }
  if (url.username !== "" || url.password !== "") {
    throw new SafePublicFetchError("invalid_url", "Public fetch URL must not include credentials");
  }
  if (url.hostname === "" || hostnameFromUrl(url).includes("%")) {
    throw new SafePublicFetchError("invalid_url", "Public fetch URL has an invalid hostname");
  }
  if (url.port !== "") {
    throw new SafePublicFetchError(
      "invalid_url",
      "Public fetch URL must use the default HTTPS port",
    );
  }
  url.hash = "";
  return url;
}

function hostnameFromUrl(url: URL): string {
  const hostname = url.hostname;
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function sanitizeRequestHeaders(input: HeadersInit | undefined): Readonly<Record<string, string>> {
  const supplied = new Headers(input);
  const sanitized: Record<string, string> = {};
  for (const [name, value] of supplied) {
    if (ALLOWED_REQUEST_HEADERS.has(name)) sanitized[name] = value;
  }
  sanitized["accept-encoding"] = "identity";
  return Object.freeze(sanitized);
}

function validateTransportResponse(response: PublicTransportResponse): void {
  if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
    throw new SafePublicFetchError(
      "invalid_response",
      "Public HTTPS transport returned an invalid status",
    );
  }
  if (!(response.headers instanceof Headers)) {
    throw new SafePublicFetchError(
      "invalid_response",
      "Public HTTPS transport returned invalid headers",
    );
  }
  if (!response.body || typeof response.body[Symbol.asyncIterator] !== "function") {
    throw new SafePublicFetchError(
      "invalid_response",
      "Public HTTPS transport returned an invalid body",
    );
  }
}

function headersFromNodeResponse(
  source: Readonly<Record<string, string | string[] | undefined>>,
): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      value.forEach((item) => headers.append(name, item));
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

async function* nodeResponseBody(
  source: AsyncIterable<Uint8Array | string>,
): AsyncGenerator<Uint8Array> {
  for await (const chunk of source) {
    yield typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
  }
}

class AbortSignalError extends Error {
  constructor() {
    super("Operation aborted");
    this.name = "AbortSignalError";
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new AbortSignalError();
}

function raceWithAbort<T>(operation: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new AbortSignalError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new AbortSignalError());
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(operation).then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

interface RequestScope {
  dispose: () => void;
  readonly signal: AbortSignal;
  readonly terminalError: SafePublicFetchError | undefined;
  readonly termination: Promise<never>;
}

function createRequestScope(
  timeoutMs: number,
  externalSignal: AbortSignal | undefined,
): RequestScope {
  const controller = new AbortController();
  let terminalError: SafePublicFetchError | undefined;
  let rejectTermination!: (error: SafePublicFetchError) => void;
  const termination = new Promise<never>((_resolve, reject) => {
    rejectTermination = reject;
  });
  const terminate = (error: SafePublicFetchError) => {
    if (terminalError !== undefined) return;
    terminalError = error;
    controller.abort(error);
    rejectTermination(error);
  };
  const onExternalAbort = () => {
    terminate(new SafePublicFetchError("aborted", "Public HTTPS request was aborted"));
  };
  if (externalSignal?.aborted) onExternalAbort();
  else externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  const timeout = setTimeout(() => {
    terminate(new SafePublicFetchError("request_timeout", "Public HTTPS request timed out"));
  }, timeoutMs);

  return {
    dispose: () => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    },
    get signal() {
      return controller.signal;
    },
    get terminalError() {
      return terminalError;
    },
    termination,
  };
}

interface SemaphoreWaiter {
  granted: boolean;
  onAbort: () => void;
  reject: (error: AbortSignalError) => void;
  resolve: (release: () => void) => void;
  signal: AbortSignal;
}

class Semaphore {
  #active = 0;
  readonly #limit: number;
  readonly #waiters: SemaphoreWaiter[] = [];

  constructor(limit: number) {
    this.#limit = limit;
  }

  acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(new AbortSignalError());
    return new Promise((resolve, reject) => {
      const waiter: SemaphoreWaiter = {
        granted: false,
        onAbort: () => {
          if (waiter.granted) return;
          const index = this.#waiters.indexOf(waiter);
          if (index !== -1) this.#waiters.splice(index, 1);
          reject(new AbortSignalError());
        },
        reject,
        resolve,
        signal,
      };
      signal.addEventListener("abort", waiter.onAbort, { once: true });
      this.#waiters.push(waiter);
      this.#dispatch();
    });
  }

  #dispatch(): void {
    while (this.#active < this.#limit) {
      const waiter = this.#waiters.shift();
      if (waiter === undefined) return;
      waiter.signal.removeEventListener("abort", waiter.onAbort);
      if (waiter.signal.aborted) {
        waiter.reject(new AbortSignalError());
        continue;
      }
      waiter.granted = true;
      this.#active += 1;
      let released = false;
      waiter.resolve(() => {
        if (released) return;
        released = true;
        this.#active -= 1;
        this.#dispatch();
      });
    }
  }
}

function positiveInteger(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new RangeError(`${name} must be a positive integer no greater than ${maximum}`);
  }
  return value;
}

function nonnegativeInteger(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${name} must be a nonnegative integer no greater than ${maximum}`);
  }
  return value;
}

function tighteningPositiveInteger(
  value: number | undefined,
  ceiling: number,
  name: string,
): number {
  if (value === undefined) return ceiling;
  const validated = positiveInteger(value, name, ceiling);
  return validated;
}

function tighteningNonnegativeInteger(
  value: number | undefined,
  ceiling: number,
  name: string,
): number {
  if (value === undefined) return ceiling;
  return nonnegativeInteger(value, name, ceiling);
}
