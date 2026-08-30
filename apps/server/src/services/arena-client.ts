import { ARENA_CHANNEL_SLUG_MAX_LENGTH } from "@rhizome/store-contract";

const ARENA_API_ORIGIN = "https://api.are.na";
const ARENA_WEB_ORIGIN = "https://www.are.na";
const CONTENTS_PER_PAGE = 100;
const DEFAULT_MAX_API_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_ASSET_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const DEFAULT_MAX_PAGES = 25;
const DEFAULT_MAX_BLOCKS = 200;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

const ASSET_HOSTS = new Set([
  "attachments.are.na",
  "d2w9rnfcy7mm78.cloudfront.net",
  "images.are.na",
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BLOCK_TYPES = new Set(["Attachment", "Embed", "Image", "Link", "Text"]);
const CHANNEL_SLUG = new RegExp(`^[a-z0-9][a-z0-9-]{0,${ARENA_CHANNEL_SLUG_MAX_LENGTH - 1}}$`);
const MIME = /^[a-z]+\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

export type ArenaFetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ArenaClientOptions {
  fetch?: ArenaFetchLike;
  maxApiResponseBytes?: number;
  maxAssetBytes?: number;
  maxBlocks?: number;
  maxPages?: number;
  maxRedirects?: number;
  maxTotalBytes?: number;
  now?: () => Date;
  requestTimeoutMs?: number;
}

export class ArenaClientError extends Error {
  constructor(
    readonly kind:
      | "invalid_channel_slug"
      | "invalid_response"
      | "limit_exceeded"
      | "provider_rejected"
      | "request_timeout"
      | "response_too_large"
      | "unsafe_endpoint",
    message: string,
  ) {
    super(message);
    this.name = "ArenaClientError";
  }
}

interface CapturedResponse {
  url: string;
  content_type: string;
  body_base64: string;
}

interface CapturedAsset extends CapturedResponse {
  block_id: number;
  redirects: CapturedAssetRedirect[];
  requested_url: string;
  role: "content" | "preview";
}

interface CapturedAssetRedirect {
  status: number;
  from_url: string;
  location: string;
  to_url: string;
}

interface FetchedBytes {
  bytes: Uint8Array;
  contentType: string;
}

interface FetchedAssetBytes extends FetchedBytes {
  finalUrl: string;
  redirects: CapturedAssetRedirect[];
  requestedUrl: string;
}

type JsonRecord = Record<string, unknown>;

/**
 * Fetches the deliberately narrow public Are.na surface and frames every response byte needed by
 * the deterministic parser. It never follows links or executes embed HTML.
 */
export class ArenaClient {
  readonly #fetch: ArenaFetchLike;
  readonly #maxApiResponseBytes: number;
  readonly #maxAssetBytes: number;
  readonly #maxBlocks: number;
  readonly #maxPages: number;
  readonly #maxRedirects: number;
  readonly #maxTotalBytes: number;
  readonly #now: () => Date;
  readonly #requestTimeoutMs: number;

  constructor(options: ArenaClientOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#maxApiResponseBytes = positiveInteger(
      options.maxApiResponseBytes ?? DEFAULT_MAX_API_RESPONSE_BYTES,
      "maxApiResponseBytes",
    );
    this.#maxAssetBytes = positiveInteger(
      options.maxAssetBytes ?? DEFAULT_MAX_ASSET_BYTES,
      "maxAssetBytes",
    );
    this.#maxBlocks = positiveInteger(options.maxBlocks ?? DEFAULT_MAX_BLOCKS, "maxBlocks");
    this.#maxPages = positiveInteger(options.maxPages ?? DEFAULT_MAX_PAGES, "maxPages");
    this.#maxRedirects = nonnegativeInteger(
      options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
      "maxRedirects",
    );
    this.#maxTotalBytes = positiveInteger(
      options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
      "maxTotalBytes",
    );
    this.#now = options.now ?? (() => new Date());
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      "requestTimeoutMs",
    );
  }

  async fetchChannelCapture(channelSlug: string): Promise<Uint8Array> {
    const slug = normalizeChannelSlug(channelSlug);
    const retrievedAt = this.#retrievedAt();

    return withDeadline(this.#requestTimeoutMs, async (signal) => {
      let totalBytes = 0;
      const accountForBytes = (bytes: Uint8Array): void => {
        totalBytes += bytes.byteLength;
        if (totalBytes > this.#maxTotalBytes) {
          throw new ArenaClientError(
            "response_too_large",
            "Are.na capture exceeded the configured total byte limit",
          );
        }
      };

      const channelUrl = new URL(`/v3/channels/${slug}`, ARENA_API_ORIGIN);
      const channelResponse = await this.#fetchApi(channelUrl, signal);
      accountForBytes(channelResponse.bytes);
      const channelEnvelope = parseJsonObject(channelResponse.bytes, "Are.na channel response");
      const channel = envelopeData(channelEnvelope, "Are.na channel response");
      const returnedSlug = requiredString(channel.slug, "Are.na channel slug");
      if (returnedSlug !== slug) {
        throw invalidResponse("Are.na returned a different channel than requested");
      }
      if (channel.state !== "available") {
        throw invalidResponse("Are.na channel is unavailable");
      }
      if (channel.visibility !== "public" && channel.visibility !== "closed") {
        throw invalidResponse("Are.na channel is not publicly readable");
      }
      const owner = record(channel.owner, "Are.na channel owner");
      const ownerSlug = requiredString(owner.slug, "Are.na channel owner slug");
      if (!CHANNEL_SLUG.test(ownerSlug)) {
        throw invalidResponse("Are.na channel owner slug is invalid");
      }
      const counts = record(channel.counts, "Are.na channel counts");
      const declaredBlocks = requiredNonnegativeInteger(
        counts.blocks,
        "Are.na channel block count",
      );
      const declaredNestedChannels = requiredNonnegativeInteger(
        counts.channels,
        "Are.na channel nested-channel count",
      );
      const declaredContents = requiredNonnegativeInteger(
        counts.contents,
        "Are.na channel content count",
      );
      if (
        declaredBlocks + declaredNestedChannels !== declaredContents ||
        declaredContents > this.#maxBlocks
      ) {
        throw new ArenaClientError(
          declaredContents > this.#maxBlocks ? "limit_exceeded" : "invalid_response",
          declaredContents > this.#maxBlocks
            ? "Are.na channel exceeded the configured content limit"
            : "Are.na channel counts are inconsistent",
        );
      }

      const pageResponses: CapturedResponse[] = [];
      const contentRecords: JsonRecord[] = [];
      let expectedTotalPages: number | undefined;
      let expectedTotalCount: number | undefined;

      for (let pageNumber = 1; pageNumber <= this.#maxPages; pageNumber += 1) {
        const contentsUrl = contentsEndpoint(slug, pageNumber);
        const response = await this.#fetchApi(contentsUrl, signal);
        accountForBytes(response.bytes);
        const envelope = parseJsonObject(response.bytes, `Are.na contents page ${pageNumber}`);
        const data = envelope.data;
        if (!Array.isArray(data)) {
          throw invalidResponse(`Are.na contents page ${pageNumber} has no data array`);
        }
        if (data.length > CONTENTS_PER_PAGE) {
          throw invalidResponse(`Are.na contents page ${pageNumber} exceeds its page size`);
        }
        const meta = record(envelope.meta, `Are.na contents page ${pageNumber} metadata`);
        const currentPage = requiredPositiveInteger(
          meta.current_page,
          `Are.na contents page ${pageNumber} current_page`,
        );
        const totalPages = requiredPositiveInteger(
          meta.total_pages,
          `Are.na contents page ${pageNumber} total_pages`,
        );
        const totalCount = requiredNonnegativeInteger(
          meta.total_count,
          `Are.na contents page ${pageNumber} total_count`,
        );
        const hasMorePages = requiredBoolean(
          meta.has_more_pages,
          `Are.na contents page ${pageNumber} has_more_pages`,
        );
        if (
          currentPage !== pageNumber ||
          totalPages < pageNumber ||
          hasMorePages !== pageNumber < totalPages
        ) {
          throw invalidResponse(`Are.na contents page ${pageNumber} pagination is inconsistent`);
        }
        if (
          (expectedTotalPages !== undefined && expectedTotalPages !== totalPages) ||
          (expectedTotalCount !== undefined && expectedTotalCount !== totalCount)
        ) {
          throw invalidResponse("Are.na contents pages disagree about pagination metadata");
        }
        expectedTotalPages = totalPages;
        expectedTotalCount = totalCount;
        if (totalPages > this.#maxPages || totalCount > this.#maxBlocks) {
          throw new ArenaClientError(
            "limit_exceeded",
            "Are.na channel exceeded the configured page or content limit",
          );
        }

        for (const [index, value] of data.entries()) {
          contentRecords.push(
            record(value, `Are.na contents page ${pageNumber} item ${index + 1}`),
          );
        }
        if (contentRecords.length > this.#maxBlocks) {
          throw new ArenaClientError(
            "limit_exceeded",
            "Are.na channel exceeded the configured content limit",
          );
        }
        pageResponses.push(captureResponse(contentsUrl, response));
        if (!hasMorePages) break;
        if (pageNumber === this.#maxPages) {
          throw new ArenaClientError(
            "limit_exceeded",
            "Are.na channel exceeded the configured page limit",
          );
        }
      }

      if (
        expectedTotalPages !== pageResponses.length ||
        expectedTotalCount !== contentRecords.length ||
        declaredContents !== contentRecords.length
      ) {
        throw invalidResponse("Are.na contents count does not match its pagination metadata");
      }

      const assets: CapturedAsset[] = [];
      const seenContentIds = new Set<number>();
      for (const [index, content] of contentRecords.entries()) {
        const label = `Are.na content ${index + 1}`;
        const contentId = requiredPositiveInteger(content.id, `${label} id`);
        if (seenContentIds.has(contentId)) {
          throw invalidResponse(`Are.na content ${contentId} appeared twice`);
        }
        seenContentIds.add(contentId);
        if (content.state !== "available") {
          throw invalidResponse(`Are.na content ${contentId} is unavailable`);
        }

        if (content.type === "Channel" || content.base_type === "Channel") continue;
        if (content.base_type !== "Block") {
          throw invalidResponse(`Are.na content ${contentId} has an unknown base type`);
        }
        const blockType = requiredString(content.type, `Are.na block ${contentId} type`);
        if (!BLOCK_TYPES.has(blockType)) {
          throw invalidResponse(`Are.na block ${contentId} has unsupported type ${blockType}`);
        }
        const source = assetSourceForBlock(content, contentId, blockType);
        if (!source) continue;

        const assetUrl = approvedAssetUrl(source.url, `Are.na block ${contentId} asset URL`);
        const asset = await this.#fetchAsset(assetUrl, signal);
        accountForBytes(asset.bytes);
        if (source.role === "preview" || blockType === "Image") {
          if (!asset.contentType.startsWith("image/")) {
            throw invalidResponse(`Are.na block ${contentId} asset is not an image`);
          }
        }
        assets.push({
          ...captureResponse(new URL(asset.finalUrl), asset),
          block_id: contentId,
          redirects: asset.redirects,
          requested_url: asset.requestedUrl,
          role: source.role,
        });
      }

      const capture = {
        version: "arena-capture@1",
        channel_url: `${ARENA_WEB_ORIGIN}/${ownerSlug}/${slug}`,
        retrieved_at: retrievedAt,
        channel: captureResponse(channelUrl, channelResponse),
        contents_pages: pageResponses,
        assets,
      } as const;
      return new TextEncoder().encode(JSON.stringify(capture));
    });
  }

  async #fetchApi(url: URL, signal: AbortSignal): Promise<FetchedBytes> {
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        redirect: "error",
        headers: { Accept: "application/json" },
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw timeoutError();
      if (error instanceof ArenaClientError) throw error;
      throw new ArenaClientError(
        "provider_rejected",
        `Are.na API request could not reach ${url.pathname}`,
      );
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new ArenaClientError(
        "provider_rejected",
        `Are.na API request failed with HTTP ${response.status}`,
      );
    }
    const responseUrl = response.url;
    if (responseUrl && responseUrl !== url.toString()) {
      await response.body?.cancel();
      throw new ArenaClientError("unsafe_endpoint", "Are.na API response changed endpoint");
    }
    const result = await readBoundedResponse(
      response,
      this.#maxApiResponseBytes,
      "Are.na API response exceeded the configured byte limit",
      signal,
    );
    if (result.bytes.byteLength === 0) {
      throw invalidResponse("Are.na API returned an empty response");
    }
    if (result.contentType !== "application/json") {
      throw invalidResponse("Are.na API response is not application/json");
    }
    return result;
  }

  async #fetchAsset(initialUrl: URL, signal: AbortSignal): Promise<FetchedAssetBytes> {
    const requestedUrl = initialUrl.toString();
    const redirectChain: CapturedAssetRedirect[] = [];
    let endpoint = initialUrl;
    for (let redirects = 0; redirects <= this.#maxRedirects; redirects += 1) {
      let response: Response;
      try {
        response = await this.#fetch(endpoint, {
          method: "GET",
          redirect: "manual",
          headers: { Accept: "*/*" },
          signal,
        });
      } catch (error) {
        if (signal.aborted) throw timeoutError();
        if (error instanceof ArenaClientError) throw error;
        throw new ArenaClientError(
          "provider_rejected",
          "Are.na asset request could not reach the provider",
        );
      }
      if (REDIRECT_STATUSES.has(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("Location");
        if (!location || redirects === this.#maxRedirects) {
          throw new ArenaClientError(
            "provider_rejected",
            "Are.na asset returned too many or malformed redirects",
          );
        }
        let redirected: URL;
        try {
          redirected = new URL(location, endpoint);
        } catch {
          throw new ArenaClientError(
            "provider_rejected",
            "Are.na asset returned a malformed redirect",
          );
        }
        const approvedRedirect = approvedAssetUrl(redirected.toString(), "Are.na asset redirect");
        redirectChain.push({
          status: response.status,
          from_url: endpoint.toString(),
          location,
          to_url: approvedRedirect.toString(),
        });
        endpoint = approvedRedirect;
        continue;
      }
      if (response.status !== 200) {
        await response.body?.cancel();
        throw new ArenaClientError(
          "provider_rejected",
          `Are.na asset request failed with HTTP ${response.status}`,
        );
      }
      const responseUrl = response.url;
      if (responseUrl && responseUrl !== endpoint.toString()) {
        await response.body?.cancel();
        throw new ArenaClientError("unsafe_endpoint", "Are.na asset response changed endpoint");
      }
      const result = await readBoundedResponse(
        response,
        this.#maxAssetBytes,
        "Are.na asset exceeded the configured byte limit",
        signal,
      );
      if (result.bytes.byteLength === 0) {
        throw invalidResponse("Are.na asset response was empty");
      }
      return {
        ...result,
        finalUrl: endpoint.toString(),
        redirects: redirectChain,
        requestedUrl,
      };
    }
    throw new ArenaClientError("provider_rejected", "Are.na asset redirect did not resolve");
  }

  #retrievedAt(): string {
    const value = this.#now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new Error("ArenaClient now() must return a valid Date");
    }
    return value.toISOString();
  }
}

function normalizeChannelSlug(value: string): string {
  if (typeof value !== "string" || !CHANNEL_SLUG.test(value)) {
    throw new ArenaClientError(
      "invalid_channel_slug",
      "Are.na channel slug must be lowercase letters, numbers, and hyphens",
    );
  }
  return value;
}

function contentsEndpoint(slug: string, pageNumber: number): URL {
  const url = new URL(`/v3/channels/${slug}/contents`, ARENA_API_ORIGIN);
  url.searchParams.set("per", String(CONTENTS_PER_PAGE));
  url.searchParams.set("page", String(pageNumber));
  url.searchParams.set("sort", "position_desc");
  return url;
}

function envelopeData(envelope: JsonRecord, label: string): JsonRecord {
  return record(envelope.data ?? envelope, label);
}

function assetSourceForBlock(
  block: JsonRecord,
  blockId: number,
  blockType: string,
): { role: "content" | "preview"; url: string } | undefined {
  const label = `Are.na block ${blockId}`;
  if (blockType === "Text") return undefined;
  if (blockType === "Attachment") {
    const attachment = record(block.attachment, `${label} attachment`);
    return {
      role: "content",
      url: requiredString(attachment.url, `${label} attachment URL`),
    };
  }
  if (blockType === "Image") {
    return { role: "content", url: originalImageUrl(block.image, label) };
  }
  if (block.image === undefined || block.image === null) return undefined;
  return { role: "preview", url: largeImageUrl(block.image, label) };
}

function originalImageUrl(value: unknown, label: string): string {
  const image = record(value, `${label} image`);
  return requiredString(image.src, `${label} original image URL`);
}

function largeImageUrl(value: unknown, label: string): string {
  const image = record(value, `${label} image`);
  const large = record(image.large, `${label} large image`);
  return requiredString(large.src, `${label} large image URL`);
}

function approvedAssetUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ArenaClientError("unsafe_endpoint", `${label} is not a valid URL`);
  }
  if (
    url.protocol !== "https:" ||
    !ASSET_HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) {
    throw new ArenaClientError(
      "unsafe_endpoint",
      `${label} is not on an approved Are.na asset host`,
    );
  }
  return url;
}

function captureResponse(url: URL, response: FetchedBytes): CapturedResponse {
  return {
    url: url.toString(),
    content_type: response.contentType,
    body_base64: Buffer.from(response.bytes).toString("base64"),
  };
}

function parseJsonObject(bytes: Uint8Array, label: string): JsonRecord {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalidResponse(`${label} is not valid UTF-8`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw invalidResponse(`${label} is not valid JSON`);
  }
  return record(value, label);
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidResponse(`${label} is not an object`);
  }
  return value as JsonRecord;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw invalidResponse(`${label} is missing`);
  }
  return value;
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw invalidResponse(`${label} is not a boolean`);
  return value;
}

function requiredPositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw invalidResponse(`${label} is not a positive integer`);
  }
  return value as number;
}

function requiredNonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalidResponse(`${label} is not a non-negative integer`);
  }
  return value as number;
}

function normalizedContentType(value: string | null): string {
  const mime = value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!MIME.test(mime)) throw invalidResponse("Are.na response has an invalid content type");
  return mime;
}

async function readBoundedResponse(
  response: Response,
  maximumBytes: number,
  message: string,
  signal: AbortSignal,
): Promise<FetchedBytes> {
  const contentType = normalizedContentType(response.headers.get("Content-Type"));
  const contentLength = response.headers.get("Content-Length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      await response.body?.cancel();
      throw invalidResponse("Are.na response has an invalid content length");
    }
    const declaredSize = Number(contentLength);
    if (!Number.isSafeInteger(declaredSize)) {
      await response.body?.cancel();
      throw invalidResponse("Are.na response has an invalid content length");
    }
    if (declaredSize > maximumBytes) {
      await response.body?.cancel();
      throw new ArenaClientError("response_too_large", message);
    }
  }
  if (!response.body) return { bytes: new Uint8Array(), contentType };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const cancelOnAbort = () => void reader.cancel();
  signal.addEventListener("abort", cancelOnAbort, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        throw new ArenaClientError("response_too_large", message);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (signal.aborted) throw timeoutError();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancelOnAbort);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, contentType };
}

async function withDeadline<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(timeoutError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), expired]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function timeoutError(): ArenaClientError {
  return new ArenaClientError("request_timeout", "Are.na channel capture timed out");
}

function invalidResponse(message: string): ArenaClientError {
  return new ArenaClientError("invalid_response", message);
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`ArenaClient ${name} must be a positive integer`);
  }
  return value;
}

function nonnegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`ArenaClient ${name} must be a non-negative integer`);
  }
  return value;
}
