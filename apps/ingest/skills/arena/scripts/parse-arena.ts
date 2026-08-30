import { createHash } from "node:crypto";

import { ARENA_CHANNEL_SLUG_MAX_LENGTH } from "../../../../../packages/store-contract/src/arena.ts";
import { ARENA_PARSER_NAME } from "../../../../../packages/store-contract/src/ingestion.ts";

export const ARENA_CAPTURE_VERSION = "arena-capture@1" as const;
export const ARENA_PARSER_VERSION = "arena@1.1.0" as const;

export type ArenaBlockType = "Text" | "Image" | "Attachment" | "Link" | "Embed";
export type ArenaElementKind = "text" | "image" | "audio" | "video" | "document";
export type ArenaAssetRole = "content" | "preview";
export type ArenaElementRole = "title" | ArenaAssetRole;

export interface CapturedArenaResponse {
  url: string;
  content_type: string;
  body_base64: string;
}

export interface CapturedArenaRedirect {
  status: number;
  from_url: string;
  location: string;
  to_url: string;
}

export interface CapturedArenaAsset extends CapturedArenaResponse {
  block_id: number;
  redirects: CapturedArenaRedirect[];
  requested_url: string;
  role: ArenaAssetRole;
}

/**
 * Immutable, self-contained framing for a public Are.na channel fetch. Every response body is
 * retained byte-for-byte as base64 so parsing and review never depend on the live provider.
 */
export interface ArenaCaptureV1 {
  version: typeof ARENA_CAPTURE_VERSION;
  channel_url: string;
  retrieved_at: string;
  channel: CapturedArenaResponse;
  contents_pages: CapturedArenaResponse[];
  assets: CapturedArenaAsset[];
}

export interface ParsedArenaElement {
  role: ArenaElementRole;
  kind: ArenaElementKind;
  mime: string;
  bytes: Uint8Array;
  byteSize: number;
  contentHash: `sha256:${string}`;
  filename: string;
  sourceUrl?: string;
}

export interface ParsedArenaBlock {
  blockId: string;
  blockType: ArenaBlockType;
  title: string;
  description?: string;
  position: number;
  keys: Record<string, string>;
  sourceProperties: Record<string, unknown>;
  elements: ParsedArenaElement[];
}

export interface ParsedArenaChannel {
  channelId: string;
  channelSlug: string;
  channelTitle: string;
  channelDescription?: string;
  channelUrl: string;
  retrievedAt: string;
  declaredBlockCount: number;
  declaredNestedChannelCount: number;
  declaredContentCount: number;
  sourceRecordCount: number;
  nestedChannelCount: number;
  sourcePositions: number[];
  blocks: ParsedArenaBlock[];
}

export interface ArenaParser {
  readonly name: typeof ARENA_PARSER_NAME;
  readonly version: typeof ARENA_PARSER_VERSION;
  parse(bytes: Uint8Array): Promise<ParsedArenaChannel>;
}

type JsonRecord = Record<string, unknown>;

interface ParsedUser {
  id: number;
  name: string;
  slug: string;
}

interface ParsedConnection {
  id: number;
  position: number;
  pinned: boolean;
  connectedAt: string;
  connectedBy?: ParsedUser;
}

interface ParsedImageDescriptor {
  originalUrl: string;
  originalMime?: string;
  filename?: string;
  fileSize?: number;
  width?: number;
  height?: number;
  altText?: string;
  approvedCaptureUrls: Set<string>;
}

interface AssetEntry {
  asset: CapturedArenaAsset;
  bytes: Uint8Array;
}

type ArenaConnectionOrder = "asc" | "desc";

const BLOCK_TYPES = new Set<ArenaBlockType>(["Text", "Image", "Attachment", "Link", "Embed"]);
const JSON_MIME = "application/json";
const MIME = /^[a-z]+\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const SLUG = new RegExp(`^[a-z0-9][a-z0-9-]{0,${ARENA_CHANNEL_SLUG_MAX_LENGTH - 1}}$`);
const DOCUMENT_MIMES = new Set([
  "application/epub+zip",
  "application/msword",
  "application/pdf",
  "application/rtf",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/rtf",
]);
const APPROVED_ASSET_HOSTS = new Set([
  "attachments.are.na",
  "d2w9rnfcy7mm78.cloudfront.net",
  "images.are.na",
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export const arenaParser: ArenaParser = {
  name: ARENA_PARSER_NAME,
  version: ARENA_PARSER_VERSION,
  async parse(bytes) {
    return parseArenaCapture(bytes);
  },
};

export function parseArenaCapture(bytes: Uint8Array): ParsedArenaChannel {
  const capture = parseCapture(bytes);
  const channelUrl = normalizeChannelUrl(capture.channel_url);
  const retrievedAt = requiredTimestamp(capture.retrieved_at, "Are.na capture retrieved_at");
  const channelResponse = decodeJsonResponse(capture.channel, "Are.na channel response");
  assertApiResponseUrl(capture.channel.url, "channel", channelUrl.slug);
  const channel = objectValue(channelResponse.data ?? channelResponse, "Are.na channel");
  const channelId = requiredPositiveInteger(channel.id, "Are.na channel id");
  const channelSlug = requiredString(channel.slug, "Are.na channel slug");
  if (!SLUG.test(channelSlug) || channelSlug !== channelUrl.slug) {
    throw new Error("Are.na channel response does not match the captured channel URL");
  }
  const channelTitle = requiredString(channel.title, "Are.na channel title");
  if (channel.state !== "available") throw new Error("Are.na channel is unavailable");
  if (channel.visibility !== "public" && channel.visibility !== "closed") {
    throw new Error("Are.na channel is not publicly readable");
  }
  const channelDescription = optionalMarkdown(channel.description, "Are.na channel description");
  const counts = objectValue(channel.counts, "Are.na channel counts");
  const declaredBlockCount = requiredNonnegativeInteger(
    counts.blocks,
    "Are.na channel block count",
  );
  const declaredNestedChannelCount = requiredNonnegativeInteger(
    counts.channels,
    "Are.na channel nested-channel count",
  );
  const declaredContentCount = requiredNonnegativeInteger(
    counts.contents,
    "Are.na channel content count",
  );
  if (declaredBlockCount + declaredNestedChannelCount !== declaredContentCount) {
    throw new Error("Are.na channel counts are inconsistent");
  }
  if (capture.contents_pages.length === 0) {
    throw new Error("Are.na capture has no contents pages");
  }

  const sourceRecords: JsonRecord[] = [];
  let declaredPageTotal: number | undefined;
  let contentsOrder: ArenaConnectionOrder | undefined;
  for (const [pageIndex, response] of capture.contents_pages.entries()) {
    const pageNumber = pageIndex + 1;
    const pageOrder = assertApiResponseUrl(response.url, "contents", channelSlug, pageNumber);
    if (contentsOrder !== undefined && pageOrder !== contentsOrder) {
      throw new Error("Are.na contents pages disagree about connection order");
    }
    contentsOrder = pageOrder;
    const page = decodeJsonResponse(response, `Are.na contents page ${pageNumber}`);
    if (!Array.isArray(page.data)) {
      throw new Error(`Are.na contents page ${pageNumber} is missing its data array`);
    }
    const meta = objectValue(page.meta, `Are.na contents page ${pageNumber} metadata`);
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
      totalPages !== capture.contents_pages.length ||
      hasMorePages !== pageNumber < totalPages
    ) {
      throw new Error(`Are.na contents page ${pageNumber} pagination is inconsistent`);
    }
    if (declaredPageTotal !== undefined && declaredPageTotal !== totalCount) {
      throw new Error("Are.na contents pages disagree about total_count");
    }
    declaredPageTotal = totalCount;
    for (const [itemIndex, value] of page.data.entries()) {
      sourceRecords.push(
        objectValue(value, `Are.na contents page ${pageNumber} item ${itemIndex + 1}`),
      );
    }
  }
  if (declaredPageTotal !== sourceRecords.length || declaredContentCount !== sourceRecords.length) {
    throw new Error("Are.na contents count does not match the captured pages");
  }

  const assets = parseAssets(capture.assets);
  const seenBlockIds = new Set<number>();
  const seenPositions = new Set<number>();
  const sourcePositions: number[] = [];
  const blocks: ParsedArenaBlock[] = [];
  let nestedChannelCount = 0;
  const expectedOrder = contentsOrder ?? "desc";
  let previousPosition = expectedOrder === "desc" ? Number.POSITIVE_INFINITY : 0;

  for (const [recordIndex, sourceRecord] of sourceRecords.entries()) {
    const label = `Are.na content ${recordIndex + 1}`;
    const connection = parseConnection(sourceRecord.connection, label);
    const outOfOrder =
      expectedOrder === "desc"
        ? connection.position >= previousPosition
        : connection.position <= previousPosition;
    if (outOfOrder || seenPositions.has(connection.position)) {
      const orderLabel = expectedOrder === "desc" ? "descending board" : "ascending connection";
      throw new Error(`Are.na contents are not in unique ${orderLabel} order`);
    }
    previousPosition = connection.position;
    seenPositions.add(connection.position);
    sourcePositions.push(connection.position);

    if (sourceRecord.type === "Channel" || sourceRecord.base_type === "Channel") {
      requiredPositiveInteger(sourceRecord.id, `${label} nested channel id`);
      if (sourceRecord.state !== "available") {
        throw new Error(`${label} nested channel is unavailable`);
      }
      nestedChannelCount += 1;
      continue;
    }
    if (sourceRecord.base_type !== "Block") throw new Error(`${label} has an unknown base type`);
    if (sourceRecord.state !== "available") throw new Error(`${label} block is unavailable`);
    const blockId = requiredPositiveInteger(sourceRecord.id, `${label} block id`);
    if (seenBlockIds.has(blockId)) throw new Error(`Are.na block ${blockId} appeared twice`);
    seenBlockIds.add(blockId);
    const blockType = requiredString(sourceRecord.type, `Are.na block ${blockId} type`);
    if (!BLOCK_TYPES.has(blockType as ArenaBlockType)) {
      throw new Error(`Are.na block ${blockId} has unsupported type ${blockType}`);
    }
    blocks.push(
      parseBlock(
        sourceRecord,
        blockId,
        blockType as ArenaBlockType,
        connection,
        channelId,
        channelSlug,
        channelTitle,
        assets,
      ),
    );
  }

  if (blocks.length !== declaredBlockCount || nestedChannelCount !== declaredNestedChannelCount) {
    throw new Error("Are.na block/channel counts do not match the captured contents");
  }
  if (assets.size > 0) {
    throw new Error(`Are.na capture has ${assets.size} unreferenced asset(s)`);
  }

  return {
    channelId: String(channelId),
    channelSlug,
    channelTitle,
    ...(channelDescription !== undefined ? { channelDescription } : {}),
    channelUrl: channelUrl.url,
    retrievedAt,
    declaredBlockCount,
    declaredNestedChannelCount,
    declaredContentCount,
    sourceRecordCount: sourceRecords.length,
    nestedChannelCount,
    sourcePositions,
    blocks,
  };
}

function parseBlock(
  block: JsonRecord,
  blockId: number,
  blockType: ArenaBlockType,
  connection: ParsedConnection,
  channelId: number,
  channelSlug: string,
  channelTitle: string,
  assets: Map<string, AssetEntry>,
): ParsedArenaBlock {
  const label = `Are.na block ${blockId}`;
  const author = parseUser(block.user, `${label} author`);
  const createdAt = requiredTimestamp(block.created_at, `${label} created_at`);
  const updatedAt = requiredTimestamp(block.updated_at, `${label} updated_at`);
  const suppliedTitle = optionalNonemptyString(block.title, `${label} title`);
  const title = suppliedTitle ?? `Are.na ${blockType.toLowerCase()} ${blockId}`;
  const description = optionalMarkdown(block.description, `${label} description`);
  const source = optionalObject(block.source, `${label} source`);
  const sourceUrl = source ? requiredHttpsUrl(source.url, `${label} source URL`) : undefined;
  const sourceTitle = source
    ? optionalNonemptyString(source.title, `${label} source title`)
    : undefined;
  const provider = source ? optionalObject(source.provider, `${label} source provider`) : undefined;
  const sourceProvider = provider
    ? {
        name: requiredString(provider.name, `${label} source provider name`),
        url: requiredHttpsUrl(provider.url, `${label} source provider URL`),
      }
    : undefined;
  const commonProperties: Record<string, unknown> = {
    arena_block_type: blockType,
    arena_channel_slug: channelSlug,
    arena_channel_title: channelTitle,
    title,
    ...(description !== undefined ? { description } : {}),
    created_at: createdAt,
    updated_at: updatedAt,
    connection_id: connection.id,
    connection_position: connection.position,
    connection_pinned: connection.pinned,
    connected_at: connection.connectedAt,
    author,
    ...(connection.connectedBy ? { connected_by: connection.connectedBy } : {}),
    ...(sourceUrl ? { source_url: sourceUrl } : {}),
    ...(sourceTitle ? { source_title: sourceTitle } : {}),
    ...(sourceProvider ? { source_provider: sourceProvider } : {}),
  };
  // The canonical block title is always the first element. Are.na titles are optional, so the
  // same deterministic fallback used by the object property becomes the renderable title when
  // the provider did not supply one.
  const titleBytes = new TextEncoder().encode(title);
  const elements: ParsedArenaElement[] = [
    elementFromBytes("title", "text", "text/plain", titleBytes, {
      filename: `arena-${blockId}-title.txt`,
    }),
  ];

  if (blockType === "Text") {
    const markdown = requiredMarkdown(block.content, `${label} content`);
    const textBytes = new TextEncoder().encode(markdown);
    if (textBytes.byteLength === 0) throw new Error(`${label} has empty markdown content`);
    elements.push(
      elementFromBytes("content", "text", "text/markdown", textBytes, {
        filename: `arena-${blockId}.md`,
      }),
    );
    rejectUnexpectedAssets(assets, blockId, label);
  } else if (blockType === "Image") {
    const image = parseImage(block.image, label);
    const entry = takeRequiredAsset(assets, blockId, "content", label);
    assertOriginalImageAsset(entry, image, label);
    elements.push(
      elementFromBytes(
        "content",
        "image",
        normalizedMime(entry.asset.content_type, label),
        entry.bytes,
        {
          filename: image.filename ?? filenameFromMime(blockId, entry.asset.content_type),
          sourceUrl: entry.asset.url,
        },
      ),
    );
    Object.assign(commonProperties, imageProperties(image, entry.asset.url));
    rejectUnexpectedAssets(assets, blockId, label);
  } else if (blockType === "Attachment") {
    const attachment = objectValue(block.attachment, `${label} attachment`);
    const attachmentUrl = approvedAssetUrl(
      requiredHttpsUrl(attachment.url, `${label} attachment URL`),
      `${label} attachment URL`,
    );
    const attachmentMime = normalizedMime(
      requiredString(attachment.content_type, `${label} attachment content type`),
      `${label} attachment content type`,
    );
    const attachmentKind = kindForAttachmentMime(attachmentMime, label);
    const entry = takeRequiredAsset(assets, blockId, "content", label);
    if (canonicalUrl(entry.asset.requested_url) !== attachmentUrl) {
      throw new Error(`${label} captured attachment URL does not match its block`);
    }
    if (normalizedMime(entry.asset.content_type, label) !== attachmentMime) {
      throw new Error(`${label} captured attachment MIME does not match its block`);
    }
    const declaredSize = optionalNonnegativeInteger(attachment.file_size, `${label} file size`);
    if (declaredSize !== undefined && declaredSize !== entry.bytes.byteLength) {
      throw new Error(`${label} captured attachment byte size does not match its block`);
    }
    const filename =
      optionalNonemptyString(attachment.filename, `${label} attachment filename`) ??
      filenameFromMime(blockId, attachmentMime);
    elements.push(
      elementFromBytes("content", attachmentKind, attachmentMime, entry.bytes, {
        filename,
        sourceUrl: entry.asset.url,
      }),
    );
    Object.assign(commonProperties, {
      attachment_url: attachmentUrl,
      attachment_content_type: attachmentMime,
      attachment_filename: filename,
      ...(declaredSize !== undefined ? { attachment_file_size: declaredSize } : {}),
      ...(optionalNonemptyString(attachment.file_extension, `${label} file extension`)
        ? { attachment_file_extension: attachment.file_extension }
        : {}),
    });
    rejectUnexpectedAssets(assets, blockId, label);
  } else if (blockType === "Link") {
    if (!sourceUrl) throw new Error(`${label} link is missing its destination URL`);
    const preview = optionalImage(block.image, label);
    if (preview) {
      const entry = takeRequiredAsset(assets, blockId, "preview", label);
      assertImageAsset(entry, preview, label);
      elements.push(
        elementFromBytes(
          "preview",
          "image",
          normalizedMime(entry.asset.content_type, label),
          entry.bytes,
          {
            filename: preview.filename ?? filenameFromMime(blockId, entry.asset.content_type),
            sourceUrl: entry.asset.url,
          },
        ),
      );
      Object.assign(commonProperties, imageProperties(preview, entry.asset.url, "preview_"));
    }
    rejectUnexpectedAssets(assets, blockId, label);
  } else {
    const embed = objectValue(block.embed, `${label} embed`);
    const embedUrl = firstHttpsUrl([embed.url, embed.source_url, sourceUrl], `${label} embed URL`);
    if (!embedUrl) throw new Error(`${label} embed is missing its destination URL`);
    const embedSourceUrl = firstHttpsUrl(
      [sourceUrl, embed.source_url],
      `${label} embed source URL`,
    );
    Object.assign(commonProperties, {
      embed_url: embedUrl,
      ...(embedSourceUrl ? { embed_source_url: embedSourceUrl } : {}),
      ...(optionalNonemptyString(embed.type, `${label} embed type`)
        ? { embed_type: embed.type }
        : {}),
      ...(optionalNonemptyString(embed.title, `${label} embed title`)
        ? { embed_title: embed.title }
        : {}),
      ...(optionalNonemptyString(embed.author_name, `${label} embed author`)
        ? { embed_author_name: embed.author_name }
        : {}),
    });
    const preview = optionalImage(block.image, label);
    if (preview) {
      const entry = takeRequiredAsset(assets, blockId, "preview", label);
      assertImageAsset(entry, preview, label);
      elements.push(
        elementFromBytes(
          "preview",
          "image",
          normalizedMime(entry.asset.content_type, label),
          entry.bytes,
          {
            filename: preview.filename ?? filenameFromMime(blockId, entry.asset.content_type),
            sourceUrl: entry.asset.url,
          },
        ),
      );
      Object.assign(commonProperties, imageProperties(preview, entry.asset.url, "preview_"));
    }
    rejectUnexpectedAssets(assets, blockId, label);
  }

  return {
    blockId: String(blockId),
    blockType,
    title,
    ...(description !== undefined ? { description } : {}),
    position: connection.position,
    keys: {
      arena_block_id: String(blockId),
      arena_channel_id: String(channelId),
    },
    sourceProperties: commonProperties,
    elements,
  };
}

function parseCapture(bytes: Uint8Array): ArenaCaptureV1 {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Are.na capture is not valid UTF-8");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    throw new Error("Are.na capture is not valid JSON");
  }
  const capture = objectValue(decoded, "Are.na capture");
  if (capture.version !== ARENA_CAPTURE_VERSION) {
    throw new Error(`Unsupported Are.na capture version: ${String(capture.version)}`);
  }
  const contentsPages = requiredArray(capture.contents_pages, "Are.na capture contents_pages");
  const assets = requiredArray(capture.assets, "Are.na capture assets");
  return {
    version: ARENA_CAPTURE_VERSION,
    channel_url: requiredString(capture.channel_url, "Are.na capture channel_url"),
    retrieved_at: requiredString(capture.retrieved_at, "Are.na capture retrieved_at"),
    channel: capturedResponse(capture.channel, "Are.na capture channel"),
    contents_pages: contentsPages.map((value, index) =>
      capturedResponse(value, `Are.na capture contents page ${index + 1}`),
    ),
    assets: assets.map((value, index) => capturedAsset(value, index + 1)),
  };
}

function capturedResponse(value: unknown, label: string): CapturedArenaResponse {
  const response = objectValue(value, label);
  return {
    url: requiredString(response.url, `${label} URL`),
    content_type: requiredString(response.content_type, `${label} content type`),
    body_base64: requiredString(response.body_base64, `${label} body`),
  };
}

function capturedAsset(value: unknown, index: number): CapturedArenaAsset {
  const asset = objectValue(value, `Are.na capture asset ${index}`);
  const response = capturedResponse(asset, `Are.na capture asset ${index}`);
  const redirects = requiredArray(asset.redirects, `Are.na capture asset ${index} redirects`);
  const role = requiredString(asset.role, `Are.na capture asset ${index} role`);
  if (role !== "content" && role !== "preview") {
    throw new Error(`Are.na capture asset ${index} has an invalid role`);
  }
  return {
    ...response,
    block_id: requiredPositiveInteger(asset.block_id, `Are.na capture asset ${index} block_id`),
    redirects: redirects.map((redirect, redirectIndex) =>
      capturedRedirect(redirect, index, redirectIndex + 1),
    ),
    requested_url: requiredString(
      asset.requested_url,
      `Are.na capture asset ${index} requested_url`,
    ),
    role,
  };
}

function capturedRedirect(
  value: unknown,
  assetIndex: number,
  redirectIndex: number,
): CapturedArenaRedirect {
  const label = `Are.na capture asset ${assetIndex} redirect ${redirectIndex}`;
  const redirect = objectValue(value, label);
  return {
    status: requiredPositiveInteger(redirect.status, `${label} status`),
    from_url: requiredString(redirect.from_url, `${label} from_url`),
    location: requiredString(redirect.location, `${label} location`),
    to_url: requiredString(redirect.to_url, `${label} to_url`),
  };
}

function parseAssets(values: CapturedArenaAsset[]): Map<string, AssetEntry> {
  const assets = new Map<string, AssetEntry>();
  for (const [index, asset] of values.entries()) {
    const label = `Are.na capture asset ${index + 1}`;
    const key = assetKey(asset.block_id, asset.role);
    if (assets.has(key)) throw new Error(`${label} duplicates ${key}`);
    const requestedUrl = approvedAssetUrl(asset.requested_url, `${label} requested URL`);
    const url = approvedAssetUrl(asset.url, `${label} response URL`);
    const redirects = validateAssetRedirects(asset.redirects, requestedUrl, url, label);
    const mime = normalizedMime(asset.content_type, `${label} content type`);
    const bytes = decodeBase64(asset.body_base64, `${label} body`);
    if (bytes.byteLength === 0) throw new Error(`${label} body is empty`);
    assets.set(key, {
      asset: {
        ...asset,
        url,
        content_type: mime,
        redirects,
        requested_url: requestedUrl,
      },
      bytes,
    });
  }
  return assets;
}

function validateAssetRedirects(
  redirects: CapturedArenaRedirect[],
  requestedUrl: string,
  responseUrl: string,
  label: string,
): CapturedArenaRedirect[] {
  let currentUrl = requestedUrl;
  const validated: CapturedArenaRedirect[] = [];
  for (const [index, redirect] of redirects.entries()) {
    const redirectLabel = `${label} redirect ${index + 1}`;
    if (!REDIRECT_STATUSES.has(redirect.status)) {
      throw new Error(`${redirectLabel} has an invalid status`);
    }
    const fromUrl = approvedAssetUrl(redirect.from_url, `${redirectLabel} from_url`);
    if (fromUrl !== currentUrl) {
      throw new Error(`${redirectLabel} does not continue the captured redirect chain`);
    }
    let resolved: URL;
    try {
      resolved = new URL(redirect.location, fromUrl);
    } catch {
      throw new Error(`${redirectLabel} has an invalid location`);
    }
    const toUrl = approvedAssetUrl(redirect.to_url, `${redirectLabel} to_url`);
    if (canonicalUrl(resolved.toString()) !== toUrl) {
      throw new Error(`${redirectLabel} location does not resolve to its captured target`);
    }
    currentUrl = toUrl;
    validated.push({ ...redirect, from_url: fromUrl, to_url: toUrl });
  }
  if (currentUrl !== responseUrl) {
    throw new Error(`${label} redirect chain does not end at its response URL`);
  }
  return validated;
}

function parseConnection(value: unknown, label: string): ParsedConnection {
  const connection = objectValue(value, `${label} connection`);
  const connectedBy = optionalObject(connection.connected_by, `${label} connected_by`);
  return {
    id: requiredPositiveInteger(connection.id, `${label} connection id`),
    position: requiredPositiveInteger(connection.position, `${label} connection position`),
    pinned: requiredBoolean(connection.pinned, `${label} connection pinned`),
    connectedAt: requiredTimestamp(connection.connected_at, `${label} connected_at`),
    ...(connectedBy ? { connectedBy: parseUser(connectedBy, `${label} connected_by`) } : {}),
  };
}

function parseUser(value: unknown, label: string): ParsedUser {
  const user = objectValue(value, label);
  return {
    id: requiredPositiveInteger(user.id, `${label} id`),
    name: requiredString(user.name, `${label} name`),
    slug: requiredString(user.slug, `${label} slug`),
  };
}

function parseImage(value: unknown, label: string): ParsedImageDescriptor {
  const image = objectValue(value, `${label} image`);
  const originalUrl = requiredHttpsUrl(image.src, `${label} original image URL`);
  const approvedCaptureUrls = new Set<string>();
  if (isApprovedAssetUrl(originalUrl)) approvedCaptureUrls.add(canonicalUrl(originalUrl));
  for (const version of ["small", "medium", "large", "square"] as const) {
    const rendition = objectValue(image[version], `${label} ${version} image`);
    for (const key of ["src", "src_2x"] as const) {
      const url = approvedAssetUrl(
        requiredHttpsUrl(rendition[key], `${label} ${version} ${key}`),
        `${label} ${version} ${key}`,
      );
      approvedCaptureUrls.add(url);
    }
  }
  const originalMime =
    image.content_type === undefined
      ? undefined
      : normalizedMime(requiredString(image.content_type, `${label} original image MIME`), label);
  if (originalMime !== undefined && !originalMime.startsWith("image/")) {
    throw new Error(`${label} original image MIME is not an image`);
  }
  return {
    originalUrl,
    ...(originalMime ? { originalMime } : {}),
    ...(optionalNonemptyString(image.filename, `${label} image filename`)
      ? { filename: image.filename as string }
      : {}),
    ...(optionalNonnegativeInteger(image.file_size, `${label} image file size`) !== undefined
      ? { fileSize: image.file_size as number }
      : {}),
    ...(optionalPositiveInteger(image.width, `${label} image width`) !== undefined
      ? { width: image.width as number }
      : {}),
    ...(optionalPositiveInteger(image.height, `${label} image height`) !== undefined
      ? { height: image.height as number }
      : {}),
    ...(optionalNonemptyString(image.alt_text, `${label} image alt text`)
      ? { altText: image.alt_text as string }
      : {}),
    approvedCaptureUrls,
  };
}

function optionalImage(value: unknown, label: string): ParsedImageDescriptor | undefined {
  if (value === undefined || value === null) return undefined;
  return parseImage(value, label);
}

function assertImageAsset(entry: AssetEntry, image: ParsedImageDescriptor, label: string): void {
  const requestedUrl = canonicalUrl(entry.asset.requested_url);
  if (!image.approvedCaptureUrls.has(requestedUrl)) {
    throw new Error(`${label} captured image URL does not match an approved block rendition`);
  }
  const mime = normalizedMime(entry.asset.content_type, label);
  if (!mime.startsWith("image/")) throw new Error(`${label} captured asset is not an image`);
  if (
    canonicalUrl(image.originalUrl) === requestedUrl &&
    image.originalMime !== undefined &&
    mime !== image.originalMime
  ) {
    throw new Error(`${label} captured original image MIME does not match its block`);
  }
  if (
    canonicalUrl(image.originalUrl) === requestedUrl &&
    image.fileSize !== undefined &&
    entry.bytes.byteLength !== image.fileSize
  ) {
    throw new Error(`${label} captured original image byte size does not match its block`);
  }
}

function assertOriginalImageAsset(
  entry: AssetEntry,
  image: ParsedImageDescriptor,
  label: string,
): void {
  assertImageAsset(entry, image, label);
  if (canonicalUrl(entry.asset.requested_url) !== canonicalUrl(image.originalUrl)) {
    throw new Error(`${label} captured image URL does not match its original asset`);
  }
}

function imageProperties(
  image: ParsedImageDescriptor,
  importedUrl: string,
  prefix = "",
): Record<string, unknown> {
  return {
    [`${prefix}original_asset_url`]: image.originalUrl,
    [`${prefix}imported_asset_url`]: importedUrl,
    ...(image.originalMime ? { [`${prefix}original_content_type`]: image.originalMime } : {}),
    ...(image.filename ? { [`${prefix}filename`]: image.filename } : {}),
    ...(image.fileSize !== undefined ? { [`${prefix}original_file_size`]: image.fileSize } : {}),
    ...(image.width !== undefined ? { [`${prefix}width`]: image.width } : {}),
    ...(image.height !== undefined ? { [`${prefix}height`]: image.height } : {}),
    ...(image.altText ? { [`${prefix}alt_text`]: image.altText } : {}),
  };
}

function elementFromBytes(
  role: ArenaElementRole,
  kind: ArenaElementKind,
  mimeValue: string,
  bytes: Uint8Array,
  metadata: { filename: string; sourceUrl?: string },
): ParsedArenaElement {
  const mime = normalizedMime(mimeValue, "Are.na element MIME");
  const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
  return {
    role,
    kind,
    mime,
    bytes,
    byteSize: bytes.byteLength,
    contentHash,
    filename: metadata.filename,
    ...(metadata.sourceUrl ? { sourceUrl: metadata.sourceUrl } : {}),
  };
}

function takeRequiredAsset(
  assets: Map<string, AssetEntry>,
  blockId: number,
  role: ArenaAssetRole,
  label: string,
): AssetEntry {
  const key = assetKey(blockId, role);
  const entry = assets.get(key);
  if (!entry) throw new Error(`${label} is missing its captured ${role} asset`);
  assets.delete(key);
  return entry;
}

function rejectUnexpectedAssets(
  assets: Map<string, AssetEntry>,
  blockId: number,
  label: string,
): void {
  for (const role of ["content", "preview"] as const) {
    if (assets.has(assetKey(blockId, role))) {
      throw new Error(`${label} has an unexpected captured ${role} asset`);
    }
  }
}

function assetKey(blockId: number, role: ArenaAssetRole): string {
  return `${blockId}:${role}`;
}

function kindForAttachmentMime(mime: string, label: string): ArenaElementKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (DOCUMENT_MIMES.has(mime)) return "document";
  throw new Error(`${label} has unsupported attachment MIME ${mime}`);
}

function filenameFromMime(blockId: number, mimeValue: string): string {
  const mime = normalizedMime(mimeValue, "Are.na filename MIME");
  const extension =
    mime === "image/jpeg"
      ? "jpg"
      : mime === "image/png"
        ? "png"
        : mime === "image/webp"
          ? "webp"
          : mime === "application/pdf"
            ? "pdf"
            : "bin";
  return `arena-${blockId}.${extension}`;
}

function decodeJsonResponse(response: CapturedArenaResponse, label: string): JsonRecord {
  if (normalizedMime(response.content_type, `${label} content type`) !== JSON_MIME) {
    throw new Error(`${label} is not application/json`);
  }
  const bytes = decodeBase64(response.body_base64, `${label} body`);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8`);
  }
  try {
    return objectValue(JSON.parse(text), label);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(label)) throw error;
    throw new Error(`${label} is not valid JSON`);
  }
}

function decodeBase64(value: string, label: string): Uint8Array {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new Error(`${label} is not canonical base64`);
  }
  const buffer = Buffer.from(value, "base64");
  if (buffer.toString("base64") !== value) throw new Error(`${label} is not canonical base64`);
  return new Uint8Array(buffer);
}

function normalizeChannelUrl(value: string): { url: string; slug: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Are.na capture has an invalid channel URL");
  }
  if (
    url.protocol !== "https:" ||
    !["are.na", "www.are.na"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    throw new Error("Are.na capture channel URL is outside the public channel boundary");
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2 || !SLUG.test(segments[0] ?? "") || !SLUG.test(segments[1] ?? "")) {
    throw new Error("Are.na capture channel URL must be /owner/channel-slug");
  }
  return { url: `https://www.are.na/${segments[0]}/${segments[1]}`, slug: segments[1]! };
}

function assertApiResponseUrl(value: string, kind: "channel", channelLocator: string): void;
function assertApiResponseUrl(
  value: string,
  kind: "contents",
  channelLocator: string,
  page: number,
): ArenaConnectionOrder;
function assertApiResponseUrl(
  value: string,
  kind: "channel" | "contents",
  channelLocator: string,
  page?: number,
): ArenaConnectionOrder | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Are.na ${kind} response has an invalid URL`);
  }
  const expectedPath = `/v3/channels/${encodeURIComponent(channelLocator)}${
    kind === "contents" ? "/contents" : ""
  }`;
  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.are.na" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== expectedPath ||
    url.hash
  ) {
    throw new Error(`Are.na ${kind} response URL is inconsistent with the capture`);
  }
  if (kind === "channel") {
    if (url.search) throw new Error("Are.na channel response URL has unexpected query parameters");
    return;
  }
  const keys = [...url.searchParams.keys()].sort();
  const sort = url.searchParams.get("sort");
  if (
    keys.join(",") !== "page,per,sort" ||
    url.searchParams.get("page") !== String(page) ||
    url.searchParams.get("per") !== "100" ||
    (sort !== "position_desc" && sort !== "position_asc")
  ) {
    throw new Error(`Are.na contents page ${page} URL is inconsistent with the capture`);
  }
  return sort === "position_desc" ? "desc" : "asc";
}

function approvedAssetUrl(value: string, label: string): string {
  const url = requiredHttpsUrl(value, label);
  if (!isApprovedAssetUrl(url)) throw new Error(`${label} is not on an approved Are.na asset host`);
  return canonicalUrl(url);
}

function isApprovedAssetUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      APPROVED_ASSET_HOSTS.has(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function canonicalUrl(value: string): string {
  return new URL(value).toString();
}

function firstHttpsUrl(values: unknown[], label: string): string | undefined {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    return requiredHttpsUrl(value, label);
  }
  return undefined;
}

function requiredHttpsUrl(value: unknown, label: string): string {
  const source = requiredString(value, label);
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(`${label} must be an HTTPS URL without credentials`);
  }
  return url.toString();
}

function normalizedMime(value: string, label: string): string {
  const mime = value.trim().toLowerCase();
  if (!MIME.test(mime)) throw new Error(`${label} has an invalid MIME type`);
  return mime;
}

function requiredMarkdown(value: unknown, label: string): string {
  if (typeof value === "string") {
    if (!value.length) throw new Error(`${label} is empty`);
    return value;
  }
  const content = objectValue(value, label);
  if (typeof content.markdown !== "string" || !content.markdown.length) {
    throw new Error(`${label} is missing original markdown`);
  }
  return content.markdown;
}

function optionalMarkdown(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.length ? value : undefined;
  const content = objectValue(value, label);
  if (typeof content.markdown !== "string") {
    throw new Error(`${label} is missing original markdown`);
  }
  return content.markdown.length ? content.markdown : undefined;
}

function objectValue(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function optionalObject(value: unknown, label: string): JsonRecord | undefined {
  if (value === undefined || value === null) return undefined;
  return objectValue(value, label);
}

function requiredArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is missing`);
  return value;
}

function optionalNonemptyString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, label);
}

function requiredPositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value as number;
}

function optionalPositiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredPositiveInteger(value, label);
}

function requiredNonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a nonnegative integer`);
  }
  return value as number;
}

function optionalNonnegativeInteger(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredNonnegativeInteger(value, label);
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean`);
  return value;
}

function requiredTimestamp(value: unknown, label: string): string {
  const timestamp = requiredString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(timestamp)) {
    throw new Error(`${label} must be an ISO UTC timestamp`);
  }
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is not a valid timestamp`);
  return timestamp;
}
