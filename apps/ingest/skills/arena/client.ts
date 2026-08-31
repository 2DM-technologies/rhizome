import type { PublicAssetFetcher, PublicAssetFetchResult } from "../../public-sources/types.ts";

import {
  normalizeArenaChannelLocator,
  type ArenaChannelLocator,
  type ArenaSourceConfig,
} from "./contracts.ts";
import {
  ARENA_CAPTURE_VERSION,
  type ArenaCaptureV1,
  type CapturedArenaAsset,
  type CapturedArenaResponse,
} from "./scripts/parse-arena.ts";

export const ARENA_API_ORIGIN = "https://api.are.na" as const;

const CONTENTS_PER_PAGE = 100;
const DEFAULT_MAX_API_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_ASSET_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const DEFAULT_MAX_PAGES = 25;
const DEFAULT_MAX_BLOCKS = 200;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const BLOCK_TYPES = new Set(["Attachment", "Embed", "Image", "Link", "Text"]);
const MIME = /^[a-z]+\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

export type ArenaApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ArenaClientOptions {
  /** Required shared adapter; there is no direct arbitrary-asset egress fallback. */
  assetFetch: PublicAssetFetcher;
  /** Fixed-origin JSON transport; useful for tests and server-owned API policy wrappers. */
  apiFetch?: ArenaApiFetch;
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
      | "invalid_channel_url"
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

interface FetchedBytes {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

type JsonRecord = Record<string, unknown>;

/**
 * Reads the narrow, unauthenticated Are.na API and frames a deterministic capture. The supplied
 * page URL is only a locator. API requests stay pinned to api.are.na; provider-declared assets are
 * delegated to the injected safe-public-fetch boundary.
 */
export class ArenaClient {
  readonly #apiFetch: ArenaApiFetch;
  readonly #assetFetch: PublicAssetFetcher;
  readonly #maxApiResponseBytes: number;
  readonly #maxAssetBytes: number;
  readonly #maxBlocks: number;
  readonly #maxPages: number;
  readonly #maxRedirects: number;
  readonly #maxTotalBytes: number;
  readonly #now: () => Date;
  readonly #requestTimeoutMs: number;

  constructor(options: ArenaClientOptions) {
    this.#apiFetch = options.apiFetch ?? globalThis.fetch;
    this.#assetFetch = options.assetFetch;
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

  async fetchChannelCapture(config: ArenaSourceConfig | string): Promise<Uint8Array> {
    let locator: ArenaChannelLocator;
    try {
      locator = normalizeArenaChannelLocator(typeof config === "string" ? config : config.url);
    } catch (error) {
      throw new ArenaClientError(
        "invalid_channel_url",
        error instanceof Error ? error.message : "Are.na channel URL is invalid",
      );
    }
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

      const channelUrl = new URL(
        `/v3/channels/${encodeURIComponent(locator.channelSlug)}`,
        ARENA_API_ORIGIN,
      );
      const channelResponse = await this.#fetchApi(channelUrl, signal);
      accountForBytes(channelResponse.bytes);
      const channelEnvelope = parseJsonObject(channelResponse.bytes, "Are.na channel response");
      const channel = envelopeData(channelEnvelope, "Are.na channel response");
      const returnedSlug = requiredString(channel.slug, "Are.na channel slug");
      if (returnedSlug !== locator.channelSlug) {
        throw invalidResponse("Are.na returned a different channel than requested");
      }
      if (channel.state !== "available") throw invalidResponse("Are.na channel is unavailable");
      if (channel.visibility !== "public" && channel.visibility !== "closed") {
        throw invalidResponse("Are.na channel is not publicly readable");
      }
      const owner = record(channel.owner, "Are.na channel owner");
      const ownerSlug = requiredString(owner.slug, "Are.na channel owner slug");
      if (ownerSlug !== locator.ownerSlug) {
        throw invalidResponse("Are.na returned a channel owned by a different user");
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
      if (declaredBlocks + declaredNestedChannels !== declaredContents) {
        throw invalidResponse("Are.na channel counts are inconsistent");
      }
      if (declaredContents > this.#maxBlocks) {
        throw new ArenaClientError(
          "limit_exceeded",
          "Are.na channel exceeded the configured content limit",
        );
      }

      const contentsPages: CapturedArenaResponse[] = [];
      const contentRecords: JsonRecord[] = [];
      let expectedTotalPages: number | undefined;
      let expectedTotalCount: number | undefined;

      for (let pageNumber = 1; pageNumber <= this.#maxPages; pageNumber += 1) {
        const contentsUrl = contentsEndpoint(locator.channelSlug, pageNumber);
        const response = await this.#fetchApi(contentsUrl, signal);
        accountForBytes(response.bytes);
        const envelope = parseJsonObject(response.bytes, `Are.na contents page ${pageNumber}`);
        if (!Array.isArray(envelope.data)) {
          throw invalidResponse(`Are.na contents page ${pageNumber} has no data array`);
        }
        if (envelope.data.length > CONTENTS_PER_PAGE) {
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
        for (const [index, value] of envelope.data.entries()) {
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
        contentsPages.push(captureResponse(contentsUrl, response));
        if (!hasMorePages) break;
        if (pageNumber === this.#maxPages) {
          throw new ArenaClientError(
            "limit_exceeded",
            "Are.na channel exceeded the configured page limit",
          );
        }
      }

      if (
        expectedTotalPages !== contentsPages.length ||
        expectedTotalCount !== contentRecords.length ||
        declaredContents !== contentRecords.length
      ) {
        throw invalidResponse("Are.na contents count does not match its pagination metadata");
      }

      const assets: CapturedArenaAsset[] = [];
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

        const requestedUrl = canonicalPublicAssetUrl(
          source.url,
          `Are.na block ${contentId} asset URL`,
        );
        const asset = await this.#fetchAsset(requestedUrl, signal);
        accountForBytes(asset.bytes);
        if (
          (source.role === "preview" || blockType === "Image") &&
          !asset.contentType.startsWith("image/")
        ) {
          throw invalidResponse(`Are.na block ${contentId} asset is not an image`);
        }
        assets.push({
          url: asset.finalUrl,
          content_type: asset.contentType,
          body_base64: Buffer.from(asset.bytes).toString("base64"),
          block_id: contentId,
          redirects: [...asset.redirects],
          requested_url: asset.requestedUrl,
          role: source.role,
        });
      }

      const capture: ArenaCaptureV1 = {
        version: ARENA_CAPTURE_VERSION,
        channel_url: locator.canonicalUrl,
        retrieved_at: retrievedAt,
        channel: captureResponse(channelUrl, channelResponse),
        contents_pages: contentsPages,
        assets,
      };
      return new TextEncoder().encode(JSON.stringify(capture));
    });
  }

  async #fetchApi(url: URL, signal: AbortSignal): Promise<FetchedBytes> {
    if (url.origin !== ARENA_API_ORIGIN || !url.pathname.startsWith("/v3/channels/")) {
      throw new ArenaClientError("unsafe_endpoint", "Are.na API endpoint is outside its boundary");
    }
    let response: Response;
    try {
      response = await this.#apiFetch(url, {
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
    if (response.url && response.url !== url.toString()) {
      await response.body?.cancel();
      throw new ArenaClientError("unsafe_endpoint", "Are.na API response changed endpoint");
    }
    const result = await readBoundedResponse(
      response,
      this.#maxApiResponseBytes,
      "Are.na API response exceeded the configured byte limit",
      signal,
    );
    if (result.bytes.byteLength === 0)
      throw invalidResponse("Are.na API returned an empty response");
    if (result.contentType !== "application/json") {
      throw invalidResponse("Are.na API response is not application/json");
    }
    return result;
  }

  async #fetchAsset(url: string, signal: AbortSignal): Promise<PublicAssetFetchResult> {
    let result: PublicAssetFetchResult;
    try {
      result = await this.#assetFetch({
        url,
        accept: "*/*",
        signal,
        maxBytes: this.#maxAssetBytes,
        maxRedirects: this.#maxRedirects,
      });
    } catch (error) {
      if (signal.aborted) throw timeoutError();
      if (error instanceof ArenaClientError) throw error;
      throw new ArenaClientError(
        "provider_rejected",
        "Are.na asset request could not reach the provider",
      );
    }
    const requestedUrl = canonicalPublicAssetUrl(result.requestedUrl, "Are.na asset request URL");
    const finalUrl = canonicalPublicAssetUrl(result.finalUrl, "Are.na asset response URL");
    if (requestedUrl !== url) {
      throw new ArenaClientError("unsafe_endpoint", "Are.na asset fetch changed its requested URL");
    }
    if (result.redirects.length > this.#maxRedirects) {
      throw new ArenaClientError("limit_exceeded", "Are.na asset exceeded the redirect limit");
    }
    if (result.bytes.byteLength === 0) throw invalidResponse("Are.na asset response was empty");
    if (result.bytes.byteLength > this.#maxAssetBytes) {
      throw new ArenaClientError(
        "response_too_large",
        "Are.na asset exceeded the configured byte limit",
      );
    }
    return {
      requestedUrl,
      finalUrl,
      contentType: normalizedContentType(result.contentType),
      bytes: result.bytes,
      redirects: result.redirects,
    };
  }

  #retrievedAt(): string {
    const value = this.#now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new Error("ArenaClient now() must return a valid Date");
    }
    return value.toISOString();
  }
}

function contentsEndpoint(slug: string, pageNumber: number): URL {
  const url = new URL(`/v3/channels/${encodeURIComponent(slug)}/contents`, ARENA_API_ORIGIN);
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
    const image = record(block.image, `${label} image`);
    return { role: "content", url: requiredString(image.src, `${label} original image URL`) };
  }
  if (block.image === undefined || block.image === null) return undefined;
  const image = record(block.image, `${label} image`);
  const large = record(image.large, `${label} large image`);
  return { role: "preview", url: requiredString(large.src, `${label} large image URL`) };
}

function canonicalPublicAssetUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ArenaClientError("unsafe_endpoint", `${label} is not a valid URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) {
    throw new ArenaClientError("unsafe_endpoint", `${label} must be a canonical public HTTPS URL`);
  }
  return url.toString();
}

function captureResponse(url: URL, response: FetchedBytes): CapturedArenaResponse {
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
  if (typeof value !== "string" || !value.trim()) throw invalidResponse(`${label} is missing`);
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
    if (!/^\d+$/.test(contentLength) || !Number.isSafeInteger(Number(contentLength))) {
      await response.body?.cancel();
      throw invalidResponse("Are.na response has an invalid content length");
    }
    if (Number(contentLength) > maximumBytes) {
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
