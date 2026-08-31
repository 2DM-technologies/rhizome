const MAX_SETUP_TOKEN_BYTES = 8_192;
const MAX_ACCESS_URL_BYTES = 4_096;
const DEFAULT_MAX_ACCOUNTS_BYTES = 20 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class SimpleFinClientError extends Error {
  constructor(
    readonly kind:
      | "claim_rejected"
      | "provider_rejected"
      | "invalid_setup_token"
      | "invalid_access_url"
      | "request_timeout"
      | "response_too_large"
      | "unsafe_endpoint",
    message: string,
  ) {
    super(message);
    this.name = "SimpleFinClientError";
  }
}

export interface SimpleFinClientOptions {
  allowedHosts: readonly string[];
  fetch?: FetchLike;
  maxAccountsBytes?: number;
  requestTimeoutMs?: number;
}

export interface SimpleFinAccountsRequest {
  accountIds?: readonly string[];
  endDateEpoch?: number;
  includePending?: boolean;
  startDateEpoch?: number;
}

export class SimpleFinClient {
  readonly #allowedHosts: ReadonlySet<string>;
  readonly #fetch: FetchLike;
  readonly #maxAccountsBytes: number;
  readonly #requestTimeoutMs: number;

  constructor(options: SimpleFinClientOptions) {
    this.#allowedHosts = new Set(options.allowedHosts.map((host) => host.toLowerCase()));
    if (this.#allowedHosts.size === 0) {
      throw new Error("At least one SimpleFIN host must be allowed");
    }
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#maxAccountsBytes = options.maxAccountsBytes ?? DEFAULT_MAX_ACCOUNTS_BYTES;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.#requestTimeoutMs) || this.#requestTimeoutMs <= 0) {
      throw new Error("SimpleFIN requestTimeoutMs must be a positive integer");
    }
  }

  async claimSetupToken(setupToken: string): Promise<string> {
    const claimUrl = this.#claimUrl(setupToken);
    return withRequestDeadline(
      this.#requestTimeoutMs,
      "SimpleFIN token exchange timed out; its one-time outcome is unknown, so disable it before creating another token",
      async (signal) => {
        let response: Response;
        try {
          response = await this.#fetch(claimUrl, {
            method: "POST",
            redirect: "error",
            headers: { "Content-Length": "0" },
            signal,
          });
        } catch {
          if (signal.aborted) {
            throw new SimpleFinClientError(
              "request_timeout",
              "SimpleFIN token exchange timed out; its one-time outcome is unknown, so disable it before creating another token",
            );
          }
          throw new SimpleFinClientError(
            "provider_rejected",
            "SimpleFIN token exchange could not reach the provider",
          );
        }
        if (response.status === 403) {
          throw new SimpleFinClientError(
            "claim_rejected",
            "SimpleFIN rejected this one-time token. It may have been claimed by someone else and could be compromised; disable it before creating another token",
          );
        }
        if (!response.ok) {
          throw new SimpleFinClientError(
            "provider_rejected",
            `SimpleFIN token exchange failed with HTTP ${response.status}`,
          );
        }
        const accessUrlBytes = await readBoundedResponse(
          response,
          MAX_ACCESS_URL_BYTES,
          "SimpleFIN access URL response exceeded the size limit",
          signal,
        );
        let accessUrlText: string;
        try {
          accessUrlText = new TextDecoder("utf-8", { fatal: true }).decode(accessUrlBytes).trim();
        } catch {
          throw new SimpleFinClientError(
            "invalid_access_url",
            "SimpleFIN returned an invalid access URL",
          );
        }
        if (!accessUrlText) {
          throw new SimpleFinClientError(
            "invalid_access_url",
            "SimpleFIN returned an invalid access URL",
          );
        }
        const accessUrl = this.#safeUrl(accessUrlText, "invalid_access_url");
        if (!accessUrl.username || !accessUrl.password) {
          throw new SimpleFinClientError(
            "invalid_access_url",
            "SimpleFIN access URL is missing Basic Auth credentials",
          );
        }
        return accessUrl.toString().replace(/\/$/, "");
      },
    );
  }

  canonicalizeSetupToken(setupToken: string): string {
    return this.#claimUrl(setupToken).toString();
  }

  async fetchAccounts(
    accessUrlText: string,
    request: SimpleFinAccountsRequest = {},
  ): Promise<Uint8Array> {
    const accessUrl = this.#safeUrl(accessUrlText, "invalid_access_url");
    if (!accessUrl.username || !accessUrl.password) {
      throw new SimpleFinClientError(
        "invalid_access_url",
        "SimpleFIN access URL is missing Basic Auth credentials",
      );
    }
    const authorization = `Basic ${Buffer.from(
      `${decodeURIComponent(accessUrl.username)}:${decodeURIComponent(accessUrl.password)}`,
    ).toString("base64")}`;
    accessUrl.username = "";
    accessUrl.password = "";
    accessUrl.pathname = `${accessUrl.pathname.replace(/\/$/, "")}/accounts`;
    accessUrl.search = "";
    accessUrl.searchParams.set("version", "2");
    if (request.startDateEpoch !== undefined) {
      assertEpoch(request.startDateEpoch, "startDateEpoch");
      accessUrl.searchParams.set("start-date", String(request.startDateEpoch));
    }
    if (request.endDateEpoch !== undefined) {
      assertEpoch(request.endDateEpoch, "endDateEpoch");
      accessUrl.searchParams.set("end-date", String(request.endDateEpoch));
    }
    if (
      request.startDateEpoch !== undefined &&
      request.endDateEpoch !== undefined &&
      request.startDateEpoch > request.endDateEpoch
    ) {
      throw new Error("SimpleFIN startDateEpoch must not exceed endDateEpoch");
    }
    for (const accountId of [...new Set(request.accountIds ?? [])].sort()) {
      accessUrl.searchParams.append("account", accountId);
    }
    if (request.includePending === true) accessUrl.searchParams.set("pending", "1");

    return withRequestDeadline(
      this.#requestTimeoutMs,
      "SimpleFIN accounts request timed out",
      async (signal) => {
        let endpoint = accessUrl;
        let response: Response | undefined;
        for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
          try {
            response = await this.#fetch(endpoint, {
              method: "GET",
              redirect: "manual",
              headers: { Accept: "application/json", Authorization: authorization },
              signal,
            });
          } catch {
            if (signal.aborted) {
              throw new SimpleFinClientError(
                "request_timeout",
                "SimpleFIN accounts request timed out",
              );
            }
            throw new SimpleFinClientError(
              "provider_rejected",
              "SimpleFIN accounts request could not reach the provider",
            );
          }
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          await response.body?.cancel();
          const location = response.headers.get("Location");
          if (!location || redirectCount === MAX_REDIRECTS) {
            throw new SimpleFinClientError(
              "provider_rejected",
              "SimpleFIN returned too many or malformed redirects",
            );
          }
          const redirected = this.#safeUrl(
            new URL(location, endpoint).toString(),
            "unsafe_endpoint",
          );
          if (redirected.origin !== endpoint.origin) {
            throw new SimpleFinClientError(
              "unsafe_endpoint",
              "SimpleFIN attempted to redirect credentials to another origin",
            );
          }
          endpoint = redirected;
        }
        if (!response) throw new Error("SimpleFIN request did not run");
        if (response.status === 403) {
          throw new SimpleFinClientError(
            "provider_rejected",
            "SimpleFIN access has been revoked or its credentials are invalid",
          );
        }
        if (!response.ok) {
          throw new SimpleFinClientError(
            "provider_rejected",
            `SimpleFIN accounts request failed with HTTP ${response.status}`,
          );
        }
        return readBoundedResponse(
          response,
          this.#maxAccountsBytes,
          "SimpleFIN accounts response exceeded the configured size limit",
          signal,
        );
      },
    );
  }

  #claimUrl(setupToken: string): URL {
    const token = setupToken.trim();
    if (
      !token ||
      Buffer.byteLength(token) > MAX_SETUP_TOKEN_BYTES ||
      !/^[A-Za-z0-9+/_-]+={0,2}$/.test(token)
    ) {
      throw new SimpleFinClientError("invalid_setup_token", "SimpleFIN setup token is invalid");
    }
    let decoded: string;
    try {
      decoded = Buffer.from(token, "base64").toString("utf8");
    } catch {
      throw new SimpleFinClientError("invalid_setup_token", "SimpleFIN setup token is invalid");
    }
    const claimUrl = this.#safeUrl(decoded, "invalid_setup_token");
    if (claimUrl.username || claimUrl.password) {
      throw new SimpleFinClientError(
        "invalid_setup_token",
        "SimpleFIN claim URL must not contain credentials",
      );
    }
    return claimUrl;
  }

  #safeUrl(
    value: string,
    kind: "invalid_setup_token" | "invalid_access_url" | "unsafe_endpoint",
  ): URL {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new SimpleFinClientError(kind, "SimpleFIN endpoint is not a valid URL");
    }
    if (
      url.protocol !== "https:" ||
      !this.#allowedHosts.has(url.hostname.toLowerCase()) ||
      url.port !== "" ||
      url.hash
    ) {
      throw new SimpleFinClientError(
        kind === "invalid_setup_token" ? kind : "unsafe_endpoint",
        "SimpleFIN endpoint is not an allowed HTTPS host",
      );
    }
    return url;
  }
}

function assertEpoch(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`SimpleFIN ${name} must be a non-negative integer`);
  }
}

async function readBoundedResponse(
  response: Response,
  maximumBytes: number,
  message: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("Content-Length");
  if (contentLength !== null) {
    const declaredSize = Number(contentLength);
    if (Number.isFinite(declaredSize) && declaredSize > maximumBytes) {
      await response.body?.cancel();
      throw new SimpleFinClientError("response_too_large", message);
    }
  }
  if (!response.body) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  const cancelOnAbort = () => void reader.cancel();
  signal?.addEventListener("abort", cancelOnAbort, { once: true });
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        throw new SimpleFinClientError("response_too_large", message);
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener("abort", cancelOnAbort);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function withRequestDeadline<T>(
  timeoutMs: number,
  timeoutMessage: string,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new SimpleFinClientError("request_timeout", timeoutMessage));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), expired]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
