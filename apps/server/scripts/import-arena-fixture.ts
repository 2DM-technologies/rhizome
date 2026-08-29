import { makeOwnerCreateMediaObjectsFormData } from "@rhizome/store-contract/multipart";
import type { OwnerCreateMediaObjectsRequest } from "@rhizome/store-contract";

const API_BASE = (process.env.RHIZOME_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const AUTHORIZATION = "Bearer dev:user";
const ARENA_API_ORIGIN = "https://api.are.na";
const MAX_API_BYTES = 5 * 1024 * 1024;
const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES = 40 * 1024 * 1024;
const MAX_BLOCKS = 200;
const MAX_CONTENT_PAGES = 25;

const storeUrl = new URL(API_BASE);
if (
  storeUrl.protocol !== "http:" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(storeUrl.hostname)
) {
  throw new Error("The fixture importer only sends development auth to a loopback Rhizome API");
}

interface CapturedResponse {
  body_base64: string;
  content_type: string;
  url: string;
}

interface CapturedAsset extends CapturedResponse {
  block_id: number;
  redirects: [];
  requested_url: string;
  role: "content";
}

interface ArenaCapture {
  version: "arena-capture@1";
  channel_url: string;
  retrieved_at: string;
  channel: CapturedResponse;
  contents_pages: CapturedResponse[];
  assets: CapturedAsset[];
}

interface FetchedBytes {
  bytes: Uint8Array;
  contentType: string;
  url: string;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as JsonRecord;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is missing`);
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} is not an integer`);
  return value as number;
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function normalizeChannelUrl(value: string): { channelUrl: string; slug: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Pass a complete public Are.na channel URL");
  }
  if (url.protocol !== "https:" || !["are.na", "www.are.na"].includes(url.hostname)) {
    throw new Error("Only https://www.are.na channel URLs are supported");
  }
  if (url.username || url.password || url.port || url.search || url.hash) {
    throw new Error("The Are.na channel URL must not contain credentials, a port, query, or hash");
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2 || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(segments[1] ?? "")) {
    throw new Error("Expected an Are.na channel URL shaped like /user/channel-slug");
  }
  const slug = segments[1]!;
  return { channelUrl: `https://www.are.na/${segments[0]}/${slug}`, slug };
}

async function fetchBounded(url: URL, maxBytes: number, accept: string): Promise<FetchedBytes> {
  const response = await fetch(url, {
    headers: { Accept: accept },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Are.na returned HTTP ${response.status} for ${url}`);
  const declaredLength = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`Are.na response exceeded ${maxBytes} bytes for ${url}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
    throw new Error(`Are.na response had an invalid size for ${url}`);
  }
  return {
    bytes,
    contentType: response.headers.get("Content-Type")?.split(";", 1)[0]?.trim() || "",
    url: response.url || url.toString(),
  };
}

function parseJson(response: FetchedBytes, label: string): JsonRecord {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(response.bytes);
  } catch {
    throw new Error(`${label} was not valid UTF-8`);
  }
  return record(JSON.parse(decoded) as unknown, label);
}

function captured(response: FetchedBytes): CapturedResponse {
  return {
    body_base64: base64(response.bytes),
    content_type: response.contentType,
    url: response.url,
  };
}

function approvedAssetUrl(value: unknown): URL {
  const url = new URL(text(value, "Are.na processed image URL"));
  if (
    url.protocol !== "https:" ||
    url.hostname !== "images.are.na" ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error(`Are.na supplied an unapproved asset URL: ${url}`);
  }
  return url;
}

async function storeJson(path: string, init: RequestInit = {}): Promise<JsonRecord> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", AUTHORIZATION);
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const body = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${response.status} ${body}`);
  return body ? record(JSON.parse(body) as unknown, `${path} response`) : {};
}

function uuidOf(uri: unknown, kind: "vibe" | "origin"): string {
  const value = text(uri, `${kind} URI`);
  const prefix = `rnet://${kind}/`;
  if (!value.startsWith(prefix)) throw new Error(`Unexpected ${kind} URI: ${value}`);
  return value.slice(prefix.length);
}

const input = process.argv[2];
if (!input) throw new Error("Usage: bun apps/server/scripts/import-arena-fixture.ts <channel-url>");

const { channelUrl, slug } = normalizeChannelUrl(input);
const retrievedAt = new Date().toISOString();
const channelResponse = await fetchBounded(
  new URL(`/v3/channels/${encodeURIComponent(slug)}`, ARENA_API_ORIGIN),
  MAX_API_BYTES,
  "application/json",
);
const channelEnvelope = parseJson(channelResponse, "Are.na channel response");
const channel = record(channelEnvelope.data ?? channelEnvelope, "Are.na channel");
const channelId = integer(channel.id, "Are.na channel id");
const channelTitle = text(channel.title, "Are.na channel title");

const contentsPages: FetchedBytes[] = [];
const blocks: JsonRecord[] = [];
for (let page = 1; page <= MAX_CONTENT_PAGES; page += 1) {
  const contentsUrl = new URL(
    `/v3/channels/${encodeURIComponent(slug)}/contents`,
    ARENA_API_ORIGIN,
  );
  contentsUrl.searchParams.set("per", "100");
  contentsUrl.searchParams.set("page", String(page));
  contentsUrl.searchParams.set("sort", "position_asc");
  const response = await fetchBounded(contentsUrl, MAX_API_BYTES, "application/json");
  const envelope = parseJson(response, `Are.na contents page ${page}`);
  const data = envelope.data;
  if (!Array.isArray(data)) throw new Error(`Are.na contents page ${page} has no data array`);
  for (const value of data) blocks.push(record(value, `Are.na contents page ${page} item`));
  contentsPages.push(response);
  const meta = record(envelope.meta, `Are.na contents page ${page} metadata`);
  if (meta.has_more_pages !== true) break;
  if (page === MAX_CONTENT_PAGES) throw new Error("Are.na channel exceeded the page limit");
}

const seenBlockIds = new Set<number>();
const imported: Array<{ block: JsonRecord; asset: FetchedBytes; blockId: number; mime: string }> =
  [];
if (blocks.length > MAX_BLOCKS)
  throw new Error(`Are.na channel exceeded the ${MAX_BLOCKS} block limit`);
let totalAssetBytes = 0;
for (const block of blocks) {
  if (block.base_type !== "Block") throw new Error("Nested Are.na channels are not supported yet");
  if (block.state !== "available")
    throw new Error(`Are.na block ${String(block.id)} is unavailable`);
  if (block.type !== "Image") {
    throw new Error(`Are.na block ${String(block.id)} has unsupported type ${String(block.type)}`);
  }
  const blockId = integer(block.id, "Are.na block id");
  if (seenBlockIds.has(blockId)) throw new Error(`Are.na block ${blockId} appeared twice`);
  seenBlockIds.add(blockId);
  const image = record(block.image, `Are.na block ${blockId} image`);
  const large = record(image.large, `Are.na block ${blockId} large image`);
  const asset = await fetchBounded(approvedAssetUrl(large.src), MAX_ASSET_BYTES, "image/*");
  if (!asset.contentType.startsWith("image/")) {
    throw new Error(`Are.na block ${blockId} returned ${asset.contentType || "no content type"}`);
  }
  totalAssetBytes += asset.bytes.byteLength;
  if (totalAssetBytes > MAX_TOTAL_ASSET_BYTES) {
    throw new Error(`Are.na channel assets exceeded ${MAX_TOTAL_ASSET_BYTES} bytes`);
  }
  imported.push({ block, asset, blockId, mime: asset.contentType });
}
if (imported.length === 0) throw new Error("The Are.na channel contained no importable images");

const capture: ArenaCapture = {
  version: "arena-capture@1",
  channel_url: channelUrl,
  retrieved_at: retrievedAt,
  channel: captured(channelResponse),
  contents_pages: contentsPages.map(captured),
  assets: imported.map(({ asset, blockId }) => ({
    ...captured(asset),
    block_id: blockId,
    redirects: [],
    requested_url: asset.url,
    role: "content",
  })),
};

const listed = await storeJson("/rnet/v0/vibes");
const vibes = Array.isArray(listed.vibes) ? listed.vibes.map((value) => record(value, "Vibe")) : [];
let vibe: JsonRecord | undefined;
let currentObjects: JsonRecord[] = [];
for (const candidate of vibes.filter((candidate) => candidate.title === channelTitle)) {
  const candidateUuid = uuidOf(candidate.uri, "vibe");
  const candidateResult = await storeJson(`/rnet/v0/vibes/${candidateUuid}/objects`);
  const candidateObjects = Array.isArray(candidateResult.mediaObjects)
    ? candidateResult.mediaObjects.map((value) => record(value, "MediaObject"))
    : [];
  const matchesChannel = candidateObjects.some(
    (object) =>
      record(object.keys ?? {}, "MediaObject keys").arena_channel_id === String(channelId),
  );
  if (candidateObjects.length === 0 || matchesChannel) {
    vibe = candidate;
    currentObjects = candidateObjects;
    break;
  }
}
if (!vibe) {
  vibe = await storeJson("/rnet/v0/vibes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: channelTitle }),
  });
}
const vibeUuid = uuidOf(vibe.uri, "vibe");
const existingBlockIds = new Set(
  currentObjects
    .map(
      (object) =>
        record(object.keys ?? {}, "MediaObject keys").arena_block_id as string | undefined,
    )
    .filter((value): value is string => typeof value === "string"),
);
const missing = imported.filter(({ blockId }) => !existingBlockIds.has(String(blockId)));

if (missing.length > 0) {
  const captureBytes = new TextEncoder().encode(JSON.stringify(capture));
  const origin = await storeJson("/rnet/v0/origins", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Rnet-Label": `arena-${slug}-capture.json`,
    },
    body: captureBytes,
  });
  const originUri = text(origin.uri, "Origin URI");
  const uploads: Record<string, Blob> = {};
  const objects: OwnerCreateMediaObjectsRequest["objects"] = missing.map(
    ({ block, asset, blockId, mime }) => {
      const upload = `block-${blockId}`;
      const extension = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
      uploads[upload] = new File(
        [asset.bytes.slice().buffer as ArrayBuffer],
        `arena-${blockId}.${extension}`,
        { type: mime },
      );
      const image = record(block.image, `Are.na block ${blockId} image`);
      const connection = record(block.connection, `Are.na block ${blockId} connection`);
      const author = record(block.user, `Are.na block ${blockId} author`);
      const source =
        block.source && typeof block.source === "object"
          ? record(block.source, "source")
          : undefined;
      return {
        type: "arena.block",
        elements: [{ upload, kind: "image", mime }],
        keys: {
          arena_block_id: String(blockId),
          arena_channel_id: String(channelId),
        },
        source: {
          ingest: { method: "parser", reproducible: true, skill: "arena@0.1.0" },
          origins: [originUri],
          retrieved_at: retrievedAt,
          properties: {
            arena_block_type: block.type,
            arena_channel_slug: slug,
            arena_channel_title: channelTitle,
            title: typeof block.title === "string" ? block.title : `Are.na image ${blockId}`,
            ...(typeof block.description === "string" ? { description: block.description } : {}),
            created_at: block.created_at,
            updated_at: block.updated_at,
            connection_position: connection.position,
            author: {
              id: author.id,
              name: author.name,
              slug: author.slug,
            },
            original_asset_url: image.src,
            imported_asset_url: asset.url,
            original_content_type: image.content_type,
            original_file_size: image.file_size,
            width: image.width,
            height: image.height,
            ...(source && typeof source.url === "string" ? { source_url: source.url } : {}),
          },
        },
      };
    },
  );
  const form = makeOwnerCreateMediaObjectsFormData({
    vibe: text(vibe.uri, "Vibe URI"),
    objects,
    uploads,
  });
  await storeJson("/rnet/v0/objects", { method: "POST", body: form });
}

console.log(
  JSON.stringify(
    {
      channel: channelUrl,
      imported: missing.length,
      total: imported.length,
      vibe_title: channelTitle,
      vibe_uuid: vibeUuid,
      vibe_url: `http://localhost:5173/vibes/${vibeUuid}`,
    },
    null,
    2,
  ),
);
