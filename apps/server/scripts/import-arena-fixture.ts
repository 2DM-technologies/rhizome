const API_BASE = (process.env.RHIZOME_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const AUTHORIZATION = "Bearer dev:user";
const ARENA_API_ORIGIN = "https://api.are.na";
const OPERATION_TIMEOUT_MS = 60_000;

export {};

type JsonRecord = Record<string, unknown>;

const storeUrl = new URL(API_BASE);
if (
  storeUrl.protocol !== "http:" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(storeUrl.hostname)
) {
  throw new Error("The fixture importer only sends development auth to a loopback Rhizome API");
}

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

async function arenaChannel(slug: string): Promise<{ id: number; title: string }> {
  const url = new URL(`/v3/channels/${encodeURIComponent(slug)}`, ARENA_API_ORIGIN);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Are.na returned HTTP ${response.status} for ${url}`);
  const envelope = record((await response.json()) as unknown, "Are.na channel response");
  const channel = record(envelope.data ?? envelope, "Are.na channel");
  return {
    id: integer(channel.id, "Are.na channel id"),
    title: text(channel.title, "Are.na channel title"),
  };
}

async function storeJson(path: string, init: RequestInit = {}): Promise<JsonRecord> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", AUTHORIZATION);
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const body = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${response.status} ${body}`);
  return body ? record(JSON.parse(body) as unknown, `${path} response`) : {};
}

async function postJson(path: string, body: JsonRecord): Promise<JsonRecord> {
  return storeJson(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function uuidOf(uri: unknown, kind: "vibe"): string {
  const value = text(uri, `${kind} URI`);
  const prefix = `rnet://${kind}/`;
  if (!value.startsWith(prefix)) throw new Error(`Unexpected ${kind} URI: ${value}`);
  return value.slice(prefix.length);
}

async function waitForOperation(operationId: string): Promise<JsonRecord> {
  const deadline = Date.now() + OPERATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const operation = await storeJson(`/rnet/v0/operations/${operationId}`);
    const status = text(operation.status, "Operation status");
    if (status === "done") return operation;
    if (["failed", "aborted"].includes(status)) {
      throw new Error(`Are.na import ${status}: ${String(operation.error ?? "unknown error")}`);
    }
    await Bun.sleep(250);
  }
  throw new Error(`Are.na import did not finish within ${OPERATION_TIMEOUT_MS} ms`);
}

const input = process.argv[2];
if (!input) throw new Error("Usage: bun run import:arena-fixture <channel-url>");

const { channelUrl, slug } = normalizeChannelUrl(input);
const channel = await arenaChannel(slug);
const listed = await storeJson("/rnet/v0/vibes");
const vibes = Array.isArray(listed.vibes) ? listed.vibes.map((value) => record(value, "Vibe")) : [];
let vibe: JsonRecord | undefined;
let existingChannel = false;
for (const candidate of vibes.filter((value) => value.title === channel.title)) {
  const candidateUuid = uuidOf(candidate.uri, "vibe");
  const candidateResult = await storeJson(`/rnet/v0/vibes/${candidateUuid}/objects`);
  const candidateObjects = Array.isArray(candidateResult.mediaObjects)
    ? candidateResult.mediaObjects.map((value) => record(value, "MediaObject"))
    : [];
  const matchesChannel = candidateObjects.some(
    (object) =>
      record(object.keys ?? {}, "MediaObject keys").arena_channel_id === String(channel.id),
  );
  if (candidateObjects.length === 0 || matchesChannel) {
    vibe = candidate;
    existingChannel = matchesChannel;
    break;
  }
}
if (!vibe) vibe = await postJson("/rnet/v0/vibes", { title: channel.title });

const vibeUuid = uuidOf(vibe.uri, "vibe");
let report: JsonRecord;
if (existingChannel) {
  const pull = record(vibe.pull, "Existing Are.na Vibe pull configuration");
  // This helper owns a single-source fixture Vibe. Refuse an ambiguous mixed-source refresh.
  if (pull.enabled !== true || !Array.isArray(pull.sources) || pull.sources.length !== 1) {
    throw new Error(
      "This channel already exists without exactly one configured source; refusing an ambiguous refresh",
    );
  }
  const refresh = await postJson(`/rnet/v0/vibes/${vibeUuid}/pull`, {});
  const operationId = text(refresh.operation_id, "Refresh operation ID");
  await waitForOperation(operationId);
  report = {
    channel: channelUrl,
    refreshed: true,
    operation_id: operationId,
    vibe_title: channel.title,
    vibe_uuid: vibeUuid,
    vibe_url: `http://localhost:5173/vibes/${vibeUuid}`,
  };
} else {
  const source = await postJson("/rnet/v0/ingestion-sources", {
    provider: "arena",
    channel_url: channelUrl,
  });
  const preview = await postJson(`/rnet/v0/vibes/${vibeUuid}/imports`, {
    source: text(source.source, "Ingestion source"),
  });
  const operationId = text(preview.operation_id, "Operation ID");
  const operation = await waitForOperation(operationId);
  const result = record(operation.result, "Import preview result");
  const verify = record(result.verify, "Import VERIFY result");
  if (verify.ok !== true) throw new Error("VERIFY rejected the Are.na fixture import");
  const candidateCount = integer(verify.candidate_count, "VERIFY candidate count");
  const elementCount = integer(verify.element_count, "VERIFY element count");

  await storeJson(`/rnet/v0/vibes/${vibeUuid}/imports/${operationId}/confirm`, {
    method: "POST",
  });
  report = {
    channel: channelUrl,
    imported: candidateCount,
    media_elements: elementCount,
    parser: text(source.parser_version, "Ingestion parser version"),
    vibe_title: channel.title,
    vibe_uuid: vibeUuid,
    vibe_url: `http://localhost:5173/vibes/${vibeUuid}`,
  };
}

console.log(JSON.stringify(report, null, 2));
