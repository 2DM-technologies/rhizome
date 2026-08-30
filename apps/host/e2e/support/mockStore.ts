import type { Page, Request, Route } from "@playwright/test";
import type { MediaElement, MediaObject, OriginArtifact, Vibe } from "@rnet/types";
import type {
  CreateImportPreviewRequest,
  IngestionSourceDocument,
  OperationDocument,
  SourceCredentialDocument,
} from "@rhizome/store-contract";

export const OWNER_ID = "0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47";
export const VIBE_ID = "0198f2a1-a09b-76aa-95d8-fc5b55b41fd2";
export const NEW_VIBE_ID = "0198f2a1-d3be-79dd-88ab-2f8e88e74cf5";
export const OBJECT_ID = "0198f2a1-b19c-77bb-a6e9-0d6c66c52ae3";
export const ELEMENT_ID = "0198f2a1-c2ad-78cc-b7fa-1e7d77d63bf4";
export const PULL_OPERATION_ID = "0198f2a1-e4cf-7add-99bc-3a9f99f85df6";
export const SOURCE_ID = "0198f2a1-f5d0-7bee-aacd-4ba0aa096e07";
export const CSV_ORIGIN_ID = "0198f2a1-0101-7a01-8a01-000000000001";
export const OFX_ORIGIN_ID = "0198f2a1-0102-7a02-8a02-000000000002";
export const CSV_IMPORT_SOURCE_ID = "0198f2a1-0201-7b01-8b01-000000000001";
export const OFX_IMPORT_SOURCE_ID = "0198f2a1-0202-7b02-8b02-000000000002";
export const CSV_IMPORT_OPERATION_ID = "0198f2a1-0301-7c01-8c01-000000000001";
export const OFX_IMPORT_OPERATION_ID = "0198f2a1-0302-7c02-8c02-000000000002";
export const SIMPLEFIN_CREDENTIAL_ID = "0198f2a1-0601-7e01-8e01-000000000001";
export const SIMPLEFIN_IMPORT_SOURCE_ID = "0198f2a1-0701-7f01-8f01-000000000001";
export const SIMPLEFIN_IMPORT_OPERATION_ID = "0198f2a1-0801-7001-9001-000000000001";
export const ARENA_IMPORT_SOURCE_ID = "0198f2a1-0a01-7a01-8a01-000000000001";
export const ARENA_IMPORT_OPERATION_ID = "0198f2a1-0b01-7b01-8b01-000000000001";
export const ARENA_ORIGIN_ID = "0198f2a1-0c01-7c01-8c01-000000000001";
export const COMPROMISED_SIMPLEFIN_TOKEN = "compromised-simplefin-setup-token";

export const VIBE_URI = `rnet://vibe/${VIBE_ID}` as const;
export const OBJECT_URI = `rnet://object/${OBJECT_ID}` as const;
export const ELEMENT_URI = `rnet://element/${ELEMENT_ID}` as const;
export const PAYLOAD_TEXT = "A seeded payload for browser tests.\n";

const fixtureVibe = {
  rnet_schema: "0.1",
  uri: VIBE_URI,
  owner: `rnet://id/${OWNER_ID}`,
  title: "Spending",
  objects: [OBJECT_URI],
  created_at: "2026-08-27T12:00:00.000Z",
  grants: [],
  inferred: {},
  pull: {
    enabled: true,
    sources: [`source:${SOURCE_ID}`],
    policy: "append_new",
  },
} satisfies Vibe;

const fixtureObject = {
  rnet_schema: "0.1",
  uri: OBJECT_URI,
  owner: `rnet://id/${OWNER_ID}`,
  type: "note",
  elements: [ELEMENT_URI],
  source: {
    ingest: { method: "authored", reproducible: false },
    origins: ["rnet://client/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b48"],
    properties: { title: "Monthly plan" },
  },
  user: { properties: { reviewed: false }, updated_at: "2026-08-27T12:00:00.000Z" },
} satisfies MediaObject;

const fixtureElement = {
  rnet_schema: "0.1",
  kind: "text",
  uri: ELEMENT_URI,
  owner: `rnet://id/${OWNER_ID}`,
  content_hash: "sha256:ddc08041941729fa9a0bdc8703756e531b8b187e3af3bc7455a424c7691d62db",
  mime: "text/plain",
  bytes: `http://127.0.0.1/rnet/v0/elements/${ELEMENT_ID}/bytes`,
  byte_size: PAYLOAD_TEXT.length,
  created_at: "2026-08-27T12:00:00.000Z",
} satisfies MediaElement;

type MockFileParser = "csv" | "ofx";
type MockParser = MockFileParser | "simplefin" | "arena";

const ARENA_BLOCKS = [
  {
    objectId: "0198f2a1-0d01-7d01-8d01-000000000005",
    elementId: "0198f2a1-0e01-7e01-8e01-000000000005",
    blockId: "49552365",
    blockType: "Attachment",
    title: "Planning notes",
    position: 5,
    kind: "document",
    mime: "application/pdf",
    payload: "%PDF-1.7\nRhizome fixture\n%%EOF\n",
    sourceUrl: "https://attachments.are.na/planning-notes.pdf",
  },
  {
    objectId: "0198f2a1-0d01-7d01-8d01-000000000001",
    elementId: "0198f2a1-0e01-7e01-8e01-000000000001",
    blockId: "49552361",
    blockType: "Text",
    title: "Manifesto",
    position: 4,
    kind: "text",
    mime: "text/markdown",
    payload: "# Love always wins\n\nA deterministic markdown block.",
  },
  {
    objectId: "0198f2a1-0d01-7d01-8d01-000000000004",
    elementId: "0198f2a1-0e01-7e01-8e01-000000000004",
    blockId: "49552364",
    blockType: "Link",
    title: "A saved link with a preview",
    position: 3,
    kind: "image",
    mime: "image/png",
    payload:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    sourceUrl: "https://example.com/with-preview",
  },
  {
    objectId: "0198f2a1-0d01-7d01-8d01-000000000002",
    elementId: "0198f2a1-0e01-7e01-8e01-000000000002",
    blockId: "49552362",
    blockType: "Image",
    title: "A still image",
    position: 2,
    kind: "image",
    mime: "image/png",
    payload:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  },
  {
    objectId: "0198f2a1-0d01-7d01-8d01-000000000003",
    blockId: "49552363",
    blockType: "Link",
    title: "A saved link without a preview",
    position: 1,
    sourceUrl: "https://example.com/no-preview",
  },
] as const;

type MockArenaBlock = (typeof ARENA_BLOCKS)[number];

function hasArenaElement(block: MockArenaBlock): block is MockArenaBlock & {
  elementId: string;
  kind: "text" | "image" | "document";
  mime: string;
  payload: string;
} {
  return "elementId" in block;
}

function arenaPayload(block: MockArenaBlock & { kind: string; payload: string }): Buffer {
  return Buffer.from(block.payload, block.kind === "image" ? "base64" : "utf8");
}

function arenaTitleElementId(index: number): string {
  return `0198f2a1-0f01-7f01-8f01-${String(index + 1).padStart(12, "0")}`;
}

function importCandidates(parser: MockParser, origin: string): MediaObject[] {
  if (parser === "arena") {
    return ARENA_BLOCKS.map((block, index): MediaObject => ({
      rnet_schema: "0.1",
      uri: `rnet://object/${block.objectId}`,
      owner: `rnet://id/${OWNER_ID}`,
      type: "arena.block",
      elements: [
        `rnet://element/${arenaTitleElementId(index)}`,
        ...(hasArenaElement(block) ? [`rnet://element/${block.elementId}`] : []),
      ],
      keys: { arena_block_id: block.blockId },
      source: {
        ingest: { method: "parser", reproducible: true, skill: "arena@test" },
        origins: [origin],
        properties: {
          title: block.title,
          arena_block_type: block.blockType,
          connection_position: block.position,
          ...("sourceUrl" in block ? { source_url: block.sourceUrl } : {}),
        },
      },
    }));
  }
  const rows =
    parser === "csv"
      ? [
          { amount: "-42.50", description: "Neighborhood Market", postedAt: "2026-08-01" },
          { amount: "2500.00", description: "Payroll", postedAt: "2026-08-02" },
          { amount: "-47.25", description: "Electric Utility", postedAt: "2026-08-03" },
        ]
      : parser === "ofx"
        ? [
            { amount: "2500.00", description: "PAYROLL DEPOSIT", postedAt: "2026-08-04" },
            { amount: "-6.50", description: "COFFEE SHOP", postedAt: "2026-08-05" },
          ]
        : [
            { amount: "-64.25", description: "Grocery Co-op", postedAt: "2026-08-06" },
            { amount: "-27.50", description: "Transit Pass", postedAt: "2026-08-07" },
          ];
  const idPrefix =
    parser === "csv" ? "0401-7d01-8d01" : parser === "ofx" ? "0402-7d02-8d02" : "0403-7d03-8d03";
  return rows.map((row, index): MediaObject => ({
    rnet_schema: "0.1",
    uri: `rnet://object/0198f2a1-${idPrefix}-${String(index + 1).padStart(12, "0")}`,
    owner: `rnet://id/${OWNER_ID}`,
    type: "transaction",
    elements: [],
    keys:
      parser === "simplefin"
        ? {
            simplefin_connection_id: "connection-1",
            simplefin_account_id: "account-1",
            simplefin_transaction_id: `transaction-${index + 1}`,
          }
        : { fitid: `${parser.toUpperCase()}-${index + 1}` },
    source: {
      ingest: { method: "parser", reproducible: true, skill: `${parser}@test` },
      origins: [origin],
      properties: {
        amount: row.amount,
        currency: "USD",
        posted_at: row.postedAt,
        raw_description: row.description,
      },
    },
  }));
}

function verifyFor(parser: MockParser, historyRecovery = false) {
  const candidateCount = parser === "arena" ? ARENA_BLOCKS.length : parser === "csv" ? 3 : 2;
  if (parser === "arena") {
    const elementBlocks = ARENA_BLOCKS.filter(hasArenaElement);
    const elementCount = ARENA_BLOCKS.length + elementBlocks.length;
    return {
      ok: true,
      source_record_count: candidateCount,
      candidate_count: candidateCount,
      nested_channel_count: 0,
      element_count: elementCount,
      total_element_bytes:
        ARENA_BLOCKS.reduce((total, block) => total + Buffer.byteLength(block.title), 0) +
        elementBlocks.reduce((total, block) => total + arenaPayload(block).byteLength, 0),
      counts_by_block_type: { Attachment: 1, Image: 1, Link: 2, Text: 1 },
      counts_by_element_kind: { document: 1, image: 2, text: 6 },
      totals_by_currency: {} as Record<string, string>,
      checks: [
        {
          name: "non_empty",
          ok: true,
          detail: `${candidateCount} importable top-level blocks`,
        },
        {
          name: "record_count",
          ok: true,
          detail: `${candidateCount} top-level source records: ${candidateCount} blocks and 0 nested channels`,
        },
        {
          name: "object_count",
          ok: true,
          detail: `${candidateCount} candidates from ${candidateCount} declared blocks`,
        },
        {
          name: "required_fields",
          ok: true,
          detail: "Every candidate preserves its channel, block type, stable ID, and title",
        },
        {
          name: "unique_block_ids",
          ok: true,
          detail: "Are.na block IDs are unique",
        },
        {
          name: "connection_order",
          ok: true,
          detail: "Top-level source and candidate order matches the descending Are.na board order",
        },
        {
          name: "element_accounting",
          ok: true,
          detail: `${elementCount} elements match their block types and roles`,
        },
        {
          name: "element_integrity",
          ok: true,
          detail: `${elementCount} element payloads have matching MIME, size, and SHA-256`,
        },
      ],
    };
  }
  const total = parser === "csv" ? "2410.25" : parser === "ofx" ? "2493.50" : "-91.75";
  const checks = [
    {
      name: "object_count",
      ok: true,
      detail: `${candidateCount} candidates from ${candidateCount} source records`,
    },
    {
      name: "required_fields",
      ok: true,
      detail: "Every transaction has amount and currency",
    },
    {
      name: "unique_transaction_ids",
      ok: true,
      detail: "Transaction IDs are unique per account",
    },
    { name: "amount_totals", ok: true, detail: `USD ${total}` },
  ];
  if (parser === "simplefin") {
    checks.push({
      name: "provider_errors",
      ok: true,
      detail: "SimpleFIN returned no connection or account errors",
    });
    if (historyRecovery) {
      checks.push({
        name: "history_recovery",
        ok: true,
        detail:
          "Owner-reviewed rebaseline resumes connected history at 2026-08-01T00:00:00.000Z after the previous balance at 2026-04-01T00:00:00.000Z",
      });
    }
  }
  return {
    ok: true,
    source_record_count: candidateCount,
    candidate_count: candidateCount,
    totals_by_currency: { USD: total },
    checks,
    ...(historyRecovery
      ? {
          history_recovery: {
            mode: "rebaseline" as const,
            reason: "simplefin_history_gap" as const,
            previous_balance_at: "2026-04-01T00:00:00.000Z",
            history_resumes_at: "2026-08-01T00:00:00.000Z",
          },
        }
      : {}),
  };
}

export interface MockOriginUpload {
  byteLength: number;
  document: OriginArtifact;
}

interface MockImportOperation {
  candidates: MediaObject[];
  document: OperationDocument;
  elements: MockStagedElement[];
  polls: number;
  source: string;
  verify: {
    ok: boolean;
    source_record_count: number;
    candidate_count: number;
    totals_by_currency: Record<string, string>;
    checks: Array<{ name: string; ok: boolean; detail: string }>;
  };
}

interface MockStagedElement {
  document: MediaElement;
  object_uri: string;
  preview_url: string;
  role: "title" | "content" | "preview";
  payload: Buffer;
}

function arenaStagedElements(): MockStagedElement[] {
  return ARENA_BLOCKS.flatMap((block, index) => {
    const titleElementId = arenaTitleElementId(index);
    const titlePayload = Buffer.from(block.title, "utf8");
    const titleElement: MockStagedElement = {
      document: {
        rnet_schema: "0.1",
        kind: "text",
        uri: `rnet://element/${titleElementId}`,
        owner: `rnet://id/${OWNER_ID}`,
        content_hash: `sha256:${(index + 10).toString(16).repeat(64)}`,
        mime: "text/plain",
        bytes: `http://127.0.0.1/rnet/v0/elements/${titleElementId}/bytes`,
        byte_size: titlePayload.byteLength,
        created_at: "2026-08-28T12:00:02.000Z",
      },
      object_uri: `rnet://object/${block.objectId}`,
      preview_url: `/rnet/v0/operations/${ARENA_IMPORT_OPERATION_ID}/elements/${titleElementId}/bytes`,
      role: "title",
      payload: titlePayload,
    };
    if (!hasArenaElement(block)) return [titleElement];

    const payload = arenaPayload(block);
    return [
      titleElement,
      {
        document: {
          rnet_schema: "0.1",
          kind: block.kind,
          uri: `rnet://element/${block.elementId}`,
          owner: `rnet://id/${OWNER_ID}`,
          content_hash: `sha256:${String(index + 1).repeat(64)}`,
          mime: block.mime,
          bytes: `http://127.0.0.1/rnet/v0/elements/${block.elementId}/bytes`,
          byte_size: payload.byteLength,
          created_at: "2026-08-28T12:00:02.000Z",
        },
        object_uri: `rnet://object/${block.objectId}`,
        preview_url: `/rnet/v0/operations/${ARENA_IMPORT_OPERATION_ID}/elements/${block.elementId}/bytes`,
        role: block.blockType === "Link" ? "preview" : "content",
        payload,
      },
    ];
  });
}

export interface MockStore {
  readonly requests: Request[];
  readonly vibes: Vibe[];
  readonly objects: Map<string, MediaObject>;
  readonly elements: Map<string, MediaElement>;
  readonly elementPayloads: Map<string, Buffer<ArrayBufferLike>>;
  readonly origins: Map<string, MockOriginUpload>;
  readonly ingestionSources: Map<string, IngestionSourceDocument>;
  readonly sourceCredentials: Map<string, SourceCredentialDocument>;
  /** Hold exactly the next user-property write until the returned release function is called. */
  holdNextUserWrite: () => () => void;
  /** Make exactly the next configured-source refresh return a SimpleFIN history-gap Problem. */
  failNextPullWithSimpleFinHistoryGap: (source: string | null) => void;
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function problem(
  route: Route,
  status: number,
  code: string,
  detail: string,
  extensions: Record<string, unknown> = {},
) {
  return route.fulfill({
    status,
    contentType: "application/problem+json",
    body: JSON.stringify({
      type: `https://rhizome.tools/problems/${code.replaceAll("_", "-")}`,
      title: status === 404 ? "Not found" : "Invalid request",
      status,
      detail,
      code,
      ...extensions,
    }),
  });
}

function noContent(route: Route) {
  return route.fulfill({ status: 204 });
}

function arenaChannelSlug(value: string): string | undefined {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    return url.protocol === "https:" &&
      ["are.na", "www.are.na"].includes(url.hostname.toLowerCase()) &&
      parts.length === 2
      ? parts[1]
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A stateful Store boundary for browser tests that exercise the real generated client and Query
 * integration without sharing Postgres or object-storage state with the server suites.
 */
export async function installMockStore(page: Page): Promise<MockStore> {
  let pendingUserWrite: Promise<void> | null = null;
  let pullOperation: Record<string, unknown> | undefined;
  let nextSimpleFinHistoryGapSource: string | null | undefined;
  let simpleFinOriginSequence = 0;
  const importOperations = new Map<string, MockImportOperation>();
  const sourceCredentialBindings = new Map<string, string>();
  const elementPayloads = new Map<string, Buffer<ArrayBufferLike>>([
    [ELEMENT_ID, Buffer.from(PAYLOAD_TEXT)],
  ]);
  const store: MockStore = {
    requests: [],
    vibes: [structuredClone(fixtureVibe)],
    objects: new Map([[OBJECT_ID, structuredClone(fixtureObject)]]),
    elements: new Map([[ELEMENT_ID, structuredClone(fixtureElement)]]),
    elementPayloads,
    origins: new Map(),
    ingestionSources: new Map(),
    sourceCredentials: new Map(),
    holdNextUserWrite: () => {
      if (pendingUserWrite) throw new Error("A user-property write is already held");
      let release!: () => void;
      pendingUserWrite = new Promise((resolve) => {
        release = resolve;
      });
      return release;
    },
    failNextPullWithSimpleFinHistoryGap: (source) => {
      nextSimpleFinHistoryGapSource = source;
    },
  };

  function fetchSimpleFinOrigin(): OriginArtifact {
    simpleFinOriginSequence += 1;
    const id = `0198f2a1-0901-7101-a001-${String(simpleFinOriginSequence).padStart(12, "0")}`;
    const payload = JSON.stringify({
      errlist: [],
      connections: [
        {
          conn_id: "connection-1",
          name: "Demo bank",
          org_id: "demo-bank",
          sfin_url: "https://demo.invalid/simplefin",
        },
      ],
      accounts: [
        {
          id: "account-1",
          conn_id: "connection-1",
          name: "Checking",
          currency: "USD",
          balance: "1200.00",
          "balance-date": 1786128000,
          transactions: [
            {
              id: "transaction-1",
              posted: 1785974400,
              amount: "-64.25",
              description: "Grocery Co-op",
            },
            {
              id: "transaction-2",
              posted: 1786060800,
              amount: "-27.50",
              description: "Transit Pass",
            },
          ],
        },
      ],
    });
    const document = {
      rnet_schema: "0.1",
      uri: `rnet://origin/${id}`,
      owner: `rnet://id/${OWNER_ID}`,
      content_hash: `sha256:${String(simpleFinOriginSequence).padStart(64, "e")}`,
      mime: "application/json",
      bytes: `http://127.0.0.1/rnet/v0/origins/${id}/bytes`,
      byte_size: Buffer.byteLength(payload),
      label: "SimpleFIN accounts response",
      uploaded_at: "2026-08-28T12:00:01.000Z",
    } satisfies OriginArtifact;
    store.origins.set(id, { byteLength: Buffer.byteLength(payload), document });
    return document;
  }

  function fetchArenaOrigin(): OriginArtifact {
    const payload = JSON.stringify({
      id: 5_549_005,
      slug: "love-always-wins",
      title: "Love always wins",
      contents: ARENA_BLOCKS.map((block) => ({
        id: Number(block.blockId),
        type: "Image",
        title: block.title,
        position: block.position,
      })),
    });
    const document = {
      rnet_schema: "0.1",
      uri: `rnet://origin/${ARENA_ORIGIN_ID}`,
      owner: `rnet://id/${OWNER_ID}`,
      content_hash: `sha256:${"f".repeat(64)}`,
      mime: "application/json",
      bytes: `http://127.0.0.1/rnet/v0/origins/${ARENA_ORIGIN_ID}/bytes`,
      byte_size: Buffer.byteLength(payload),
      label: "arena-love-always-wins.json",
      uploaded_at: "2026-08-28T12:00:01.000Z",
    } satisfies OriginArtifact;
    store.origins.set(ARENA_ORIGIN_ID, { byteLength: Buffer.byteLength(payload), document });
    return document;
  }

  await page.route("**/rnet/v0/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    store.requests.push(request);

    if (method === "GET" && path === "/rnet/v0/vibes") {
      return json(route, { vibes: store.vibes });
    }

    if (method === "POST" && path === "/rnet/v0/vibes") {
      const input = request.postDataJSON() as { title: string };
      const vibe = {
        rnet_schema: "0.1",
        uri: `rnet://vibe/${NEW_VIBE_ID}`,
        owner: `rnet://id/${OWNER_ID}`,
        title: input.title,
        objects: [],
        created_at: "2026-08-27T12:02:00.000Z",
        grants: [],
        inferred: {},
      } satisfies Vibe;
      store.vibes.push(vibe);
      return json(route, vibe, 201);
    }

    if (method === "POST" && path === "/rnet/v0/origins") {
      const label = request.headers()["x-rnet-label"] ?? "transaction-export";
      const extension = label.toLowerCase().split(".").at(-1);
      const parser: MockFileParser = extension === "qfx" || extension === "ofx" ? "ofx" : "csv";
      const id = parser === "csv" ? CSV_ORIGIN_ID : OFX_ORIGIN_ID;
      const body = request.postDataBuffer();
      const document = {
        rnet_schema: "0.1",
        uri: `rnet://origin/${id}`,
        owner: `rnet://id/${OWNER_ID}`,
        content_hash: `sha256:${parser === "csv" ? "a".repeat(64) : "b".repeat(64)}`,
        mime: request.headers()["content-type"] ?? "application/octet-stream",
        bytes: `http://127.0.0.1/rnet/v0/origins/${id}/bytes`,
        byte_size: body?.byteLength ?? 0,
        label,
        uploaded_at: "2026-08-28T12:00:00.000Z",
      } satisfies OriginArtifact;
      store.origins.set(id, { byteLength: body?.byteLength ?? 0, document });
      return json(route, document, 201);
    }

    if (method === "POST" && path === "/rnet/v0/source-credentials/simplefin") {
      const input = request.postDataJSON() as { setup_token: string };
      if (input.setup_token === COMPROMISED_SIMPLEFIN_TOKEN) {
        return problem(
          route,
          422,
          "source_connection_failed",
          "SimpleFIN rejected this setup token. It may be compromised; disable it in SimpleFIN Bridge and create a new one.",
        );
      }
      const document = {
        credential: `credential:${SIMPLEFIN_CREDENTIAL_ID}`,
        provider: "simplefin",
        status: "active",
        connected_at: "2026-08-28T12:00:00.000Z",
      } satisfies SourceCredentialDocument;
      store.sourceCredentials.set(document.credential, document);
      return json(route, document, 201);
    }

    if (method === "POST" && path === "/rnet/v0/ingestion-sources") {
      const input = request.postDataJSON() as
        | { origin: string; parser: MockFileParser }
        | { provider: "arena"; channel_url: string }
        | {
            credential: string;
            config?: {
              accounts?: Array<{ connection_id: string; account_id: string }>;
              include_pending?: boolean;
            };
          };
      if ("provider" in input) {
        const channelSlug = arenaChannelSlug(input.channel_url);
        if (!channelSlug) {
          return problem(route, 422, "schema_violation", "Enter a public Are.na channel URL");
        }
        const document = {
          source: `source:${ARENA_IMPORT_SOURCE_ID}`,
          kind: "remote",
          provider: "arena",
          parser: "arena",
          parser_version: "arena@1.1.0",
          config: { channel_slug: channelSlug },
          created_at: "2026-08-28T12:00:01.000Z",
        } satisfies IngestionSourceDocument;
        store.ingestionSources.set(document.source, document);
        return json(route, document, 201);
      }
      if ("credential" in input) {
        const credential = store.sourceCredentials.get(input.credential);
        if (!credential || credential.status !== "active") {
          return problem(route, 404, "not_found", "The source credential does not exist");
        }
        const document = {
          source: `source:${SIMPLEFIN_IMPORT_SOURCE_ID}`,
          kind: "credential",
          parser: "simplefin",
          parser_version: "simplefin@2.0.0",
          config: input.config ?? {},
          created_at: "2026-08-28T12:00:01.000Z",
        } satisfies IngestionSourceDocument;
        store.ingestionSources.set(document.source, document);
        sourceCredentialBindings.set(document.source, input.credential);
        return json(route, document, 201);
      }
      const originId = input.origin.split("/").at(-1) ?? "";
      if (!store.origins.has(originId)) {
        return problem(route, 404, "not_found", "The OriginArtifact does not exist");
      }
      const id = input.parser === "csv" ? CSV_IMPORT_SOURCE_ID : OFX_IMPORT_SOURCE_ID;
      const document = {
        source: `source:${id}`,
        kind: "origin",
        parser: input.parser,
        parser_version: input.parser === "csv" ? "csv@1.1.0" : "ofx@1.1.0",
        origin: input.origin,
        created_at: "2026-08-28T12:00:01.000Z",
      } satisfies IngestionSourceDocument;
      store.ingestionSources.set(document.source, document);
      return json(route, document, 201);
    }

    const vibeObjects = path.match(/^\/rnet\/v0\/vibes\/([^/]+)\/objects$/);
    if (vibeObjects) {
      const vibe = store.vibes.find((candidate) => candidate.uri.endsWith(`/${vibeObjects[1]}`));
      if (!vibe) return problem(route, 404, "not_found", "The Vibe does not exist");
      if (method === "GET") {
        return json(route, {
          mediaObjects: vibe.objects.flatMap((uri) => {
            const object = store.objects.get(uri.split("/").at(-1) ?? "");
            return object ? [object] : [];
          }),
        });
      }
      if (method === "POST" || method === "DELETE") {
        const input = request.postDataJSON() as { objects: string[] };
        if (method === "POST") vibe.objects.push(...input.objects);
        else vibe.objects = vibe.objects.filter((uri) => !input.objects.includes(uri));
        return noContent(route);
      }
    }

    const importConfirm = path.match(/^\/rnet\/v0\/vibes\/([^/]+)\/imports\/([^/]+)\/confirm$/);
    if (method === "POST" && importConfirm) {
      const vibe = store.vibes.find((candidate) => candidate.uri.endsWith(`/${importConfirm[1]}`));
      const staged = importOperations.get(importConfirm[2] ?? "");
      if (!vibe || !staged) {
        return problem(route, 404, "not_found", "The staged import does not exist");
      }
      if (staged.document.status !== "done" || staged.document.committed_at) {
        return problem(route, 422, "import_review_invalid", "The staged import cannot be consumed");
      }
      for (const candidate of staged.candidates) {
        const id = candidate.uri.split("/").at(-1) ?? "";
        store.objects.set(id, candidate);
        if (!vibe.objects.includes(candidate.uri)) vibe.objects.push(candidate.uri);
      }
      for (const element of staged.elements) {
        const id = element.document.uri.split("/").at(-1) ?? "";
        store.elements.set(id, element.document);
        elementPayloads.set(id, element.payload);
      }
      const configuredSources = vibe.pull?.sources ?? [];
      vibe.pull = {
        enabled: true,
        policy: vibe.pull?.policy ?? "append_new",
        sources: configuredSources.includes(staged.source)
          ? configuredSources
          : [...configuredSources, staged.source],
      };
      staged.document.committed_at = "2026-08-28T12:00:04.000Z";
      return json(route, vibe);
    }

    const vibeImports = path.match(/^\/rnet\/v0\/vibes\/([^/]+)\/imports$/);
    if (method === "POST" && vibeImports) {
      const vibe = store.vibes.find((candidate) => candidate.uri.endsWith(`/${vibeImports[1]}`));
      if (!vibe) return problem(route, 404, "not_found", "The Vibe does not exist");
      const input: CreateImportPreviewRequest = request.postDataJSON();
      const source = store.ingestionSources.get(input.source);
      if (!source) return problem(route, 404, "not_found", "The ingestion source does not exist");
      let origin: string;
      if (source.kind === "credential") {
        const credentialId = sourceCredentialBindings.get(source.source);
        const credential = credentialId ? store.sourceCredentials.get(credentialId) : undefined;
        if (!credential || credential.status !== "active") {
          return problem(route, 404, "not_found", "The source credential does not exist");
        }
        origin = fetchSimpleFinOrigin().uri;
      } else if (source.kind === "remote") {
        origin = fetchArenaOrigin().uri;
      } else {
        origin = source.origin;
      }
      const parser = source.parser;
      const operationId =
        parser === "csv"
          ? CSV_IMPORT_OPERATION_ID
          : parser === "ofx"
            ? OFX_IMPORT_OPERATION_ID
            : parser === "arena"
              ? ARENA_IMPORT_OPERATION_ID
              : SIMPLEFIN_IMPORT_OPERATION_ID;
      const candidates = importCandidates(parser, origin);
      const verify = verifyFor(parser, parser === "simplefin" && input.rebaseline === true);
      const elements = parser === "arena" ? arenaStagedElements() : [];
      const document = {
        operation_id: operationId,
        kind: "pull",
        status: "queued",
        request: {
          mode: "import_preview",
          source: source.source,
          rebaseline: input.rebaseline ?? false,
        },
        result: null,
        error: null,
        created_at: "2026-08-28T12:00:02.000Z",
      } satisfies OperationDocument;
      importOperations.set(operationId, {
        candidates,
        document,
        elements,
        polls: 0,
        source: source.source,
        verify,
      });
      return json(route, document, 202);
    }

    const vibePull = path.match(/^\/rnet\/v0\/vibes\/([^/]+)\/pull$/);
    if (method === "POST" && vibePull) {
      const vibe = store.vibes.find((candidate) => candidate.uri.endsWith(`/${vibePull[1]}`));
      if (!vibe) return problem(route, 404, "not_found", "The Vibe does not exist");
      if (nextSimpleFinHistoryGapSource !== undefined) {
        const source = nextSimpleFinHistoryGapSource;
        nextSimpleFinHistoryGapSource = undefined;
        return problem(
          route,
          422,
          "simplefin_history_gap",
          "The previous connected balance cannot be reconciled inside SimpleFIN's history window.",
          source ? { source, recovery: "reviewed_rebaseline" } : {},
        );
      }
      for (const sourceId of vibe.pull?.sources ?? []) {
        const source = store.ingestionSources.get(sourceId);
        if (source?.kind === "credential") {
          fetchSimpleFinOrigin();
        } else if (source?.kind === "remote") {
          fetchArenaOrigin();
        }
      }
      pullOperation = {
        operation_id: PULL_OPERATION_ID,
        kind: "pull",
        status: "done",
        request: { mode: "pull", dry_run: false, sources: vibe.pull?.sources ?? [] },
        result: {
          policy: "append_new",
          dry_run: false,
          candidate_count: 1,
          duplicate_count: 1,
          added_count: 0,
          created_count: 0,
          removed_count: 0,
          candidates: [],
          source_results: [],
        },
        error: null,
        created_at: "2026-08-27T12:03:00.000Z",
        finished_at: "2026-08-27T12:03:00.100Z",
        committed_at: "2026-08-27T12:03:00.100Z",
      };
      return json(route, pullOperation, 202);
    }

    const operationDocument = path.match(/^\/rnet\/v0\/operations\/([^/]+)$/);
    if (method === "GET" && operationDocument) {
      const staged = importOperations.get(operationDocument[1] ?? "");
      if (staged) {
        staged.polls += 1;
        if (staged.polls === 1) {
          staged.document.status = "running";
        } else if (staged.document.status !== "done") {
          const reviewDigest = `sha256:${"c".repeat(64)}`;
          staged.document.status = "done";
          staged.document.result = {
            candidates: staged.candidates,
            elements: staged.elements.map((element) => ({
              uri: element.document.uri,
              kind: element.document.kind,
              mime: element.document.mime,
              byte_size: element.document.byte_size,
              content_hash: element.document.content_hash,
              preview_url: element.preview_url,
              object_uri: element.object_uri,
              role: element.role,
            })),
            verify: staged.verify,
            source_digest: `sha256:${"d".repeat(64)}`,
            review_digest: reviewDigest,
          };
          staged.document.review_digest = reviewDigest;
          staged.document.finished_at = "2026-08-28T12:00:03.000Z";
        }
        return json(route, staged.document);
      }
      return operationDocument[1] === PULL_OPERATION_ID && pullOperation
        ? json(route, pullOperation)
        : problem(route, 404, "not_found", "The operation does not exist");
    }

    const previewElementBytes = path.match(
      /^\/rnet\/v0\/operations\/([^/]+)\/elements\/([^/]+)\/bytes$/,
    );
    if (method === "GET" && previewElementBytes) {
      const staged = importOperations.get(previewElementBytes[1] ?? "");
      const element = staged?.elements.find((candidate) =>
        candidate.document.uri.endsWith(`/${previewElementBytes[2]}`),
      );
      if (!element) return problem(route, 404, "not_found", "The element preview does not exist");
      if (!request.headers()["authorization"]?.startsWith("Bearer ")) {
        return problem(route, 401, "authentication_required", "Authentication is required");
      }
      return route.fulfill({
        status: 200,
        contentType: element.document.mime,
        body: element.payload,
      });
    }

    const vibeDocument = path.match(/^\/rnet\/v0\/vibes\/([^/]+)$/);
    if (vibeDocument) {
      const id = vibeDocument[1] ?? "";
      const vibe = store.vibes.find((candidate) => candidate.uri.endsWith(`/${vibeDocument[1]}`));
      if (!vibe) return problem(route, 404, "not_found", "The Vibe does not exist");
      if (method === "GET") return json(route, vibe);
      if (method === "PATCH") {
        const input = request.postDataJSON() as { title?: string };
        if (input.title !== undefined) vibe.title = input.title;
        return json(route, vibe);
      }
      if (method === "DELETE") {
        store.vibes.splice(
          store.vibes.findIndex((candidate) => candidate.uri.endsWith(`/${id}`)),
          1,
        );
        return noContent(route);
      }
    }

    const elementBytes = path.match(/^\/rnet\/v0\/elements\/([^/]+)\/bytes$/);
    if (method === "GET" && elementBytes) {
      const element = store.elements.get(elementBytes[1] ?? "");
      if (!element) return problem(route, 404, "not_found", "The element does not exist");
      return route.fulfill({
        status: 200,
        contentType: element.mime,
        body: elementPayloads.get(elementBytes[1] ?? "") ?? Buffer.from(PAYLOAD_TEXT),
      });
    }

    const elementDocument = path.match(/^\/rnet\/v0\/elements\/([^/]+)$/);
    if (method === "GET" && elementDocument) {
      const element = store.elements.get(elementDocument[1] ?? "");
      return element
        ? json(route, element)
        : problem(route, 404, "not_found", "The element does not exist");
    }

    const objectDocument = path.match(/^\/rnet\/v0\/objects\/([^/]+)$/);
    if (method === "GET" && objectDocument) {
      const object = store.objects.get(objectDocument[1] ?? "");
      return object
        ? json(route, object)
        : problem(route, 404, "not_found", "The object does not exist");
    }

    const setUser = path.match(/^\/rnet\/v0\/objects\/([^/]+)\/user$/);
    if (method === "PATCH" && setUser) {
      const gate = pendingUserWrite;
      pendingUserWrite = null;
      if (gate) await gate;
      const id = setUser[1] ?? "";
      const object = store.objects.get(id);
      if (!object) return problem(route, 404, "not_found", "The object does not exist");
      const input = request.postDataJSON() as { properties: Record<string, unknown> };
      const updated: MediaObject = {
        ...object,
        user: { properties: input.properties, updated_at: "2026-08-27T12:01:00.000Z" },
      };
      store.objects.set(id, updated);
      return json(route, updated);
    }

    return problem(route, 404, "not_found", `No mock route for ${method} ${path}`);
  });

  return store;
}
