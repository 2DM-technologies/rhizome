import { describe, expect, test } from "bun:test";
import { ARENA_CHANNEL_SLUG_MAX_LENGTH } from "@rhizome/store-contract";

import {
  parseArenaCapture,
  type ArenaCaptureV1,
} from "../../ingest/skills/arena/scripts/parse-arena.ts";
import { verifyArena } from "../../ingest/verify/arena.ts";
import { ArenaClient, type ArenaFetchLike } from "../src/services/arena-client.ts";

const SLUG = "mixed-media";
const CHANNEL_URL = `https://api.are.na/v3/channels/${SLUG}`;
const PAGE_1_URL = `https://api.are.na/v3/channels/${SLUG}/contents?per=100&page=1&sort=position_desc`;

type JsonRecord = Record<string, unknown>;

interface StubResponse {
  body?: BodyInit | null;
  headers?: HeadersInit;
  status?: number;
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function channelBody(contents: number, blocks = contents, channels = 0): string {
  return JSON.stringify({
    data: {
      id: 44,
      slug: SLUG,
      title: "Mixed media",
      state: "available",
      visibility: "public",
      owner: { id: 7, slug: "test-owner" },
      counts: { blocks, channels, contents },
    },
  });
}

function pageBody(
  data: JsonRecord[],
  options: {
    currentPage?: number;
    hasMorePages?: boolean;
    totalCount?: number;
    totalPages?: number;
  } = {},
): string {
  return JSON.stringify({
    data,
    meta: {
      current_page: options.currentPage ?? 1,
      total_pages: options.totalPages ?? 1,
      total_count: options.totalCount ?? data.length,
      has_more_pages: options.hasMorePages ?? false,
    },
  });
}

function block(id: number, type: string, extra: JsonRecord = {}): JsonRecord {
  return { id, base_type: "Block", type, state: "available", ...extra };
}

function stubFetch(replies: Map<string, StubResponse[]>, requests: Request[] = []): ArenaFetchLike {
  return async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    const queue = replies.get(request.url);
    const reply = queue?.shift();
    if (!reply) throw new Error(`Unexpected request: ${request.url}`);
    return new Response(reply.body ?? null, {
      status: reply.status ?? 200,
      headers: reply.headers,
    });
  };
}

function base64(value: string): string {
  return Buffer.from(value).toString("base64");
}

function twoResponseClient(
  channel: string,
  page: string,
  options: ConstructorParameters<typeof ArenaClient>[0] = {},
): { client: ArenaClient; requests: Request[] } {
  const requests: Request[] = [];
  const fetch = stubFetch(
    new Map([
      [CHANNEL_URL, [{ body: channel, headers: { "Content-Type": "application/json" } }]],
      [PAGE_1_URL, [{ body: page, headers: { "Content-Type": "application/json" } }]],
    ]),
    requests,
  );
  return { client: new ArenaClient({ ...options, fetch }), requests };
}

describe("Are.na capture HTTP client", () => {
  test("round-trips the committed mixed v3 fixture through capture, parse, and VERIFY", async () => {
    const fixtureBytes = new Uint8Array(
      await Bun.file(
        new URL("../../ingest/skills/arena/fixtures/mixed-channel-capture.json", import.meta.url),
      ).arrayBuffer(),
    );
    const fixture = JSON.parse(new TextDecoder().decode(fixtureBytes)) as ArenaCaptureV1;
    const replies = new Map<string, StubResponse[]>();
    const addReply = (response: { url: string; content_type: string; body_base64: string }) => {
      const queue = replies.get(response.url) ?? [];
      queue.push({
        body: Buffer.from(response.body_base64, "base64"),
        headers: { "Content-Type": response.content_type },
      });
      replies.set(response.url, queue);
    };
    addReply(fixture.channel);
    fixture.contents_pages.forEach(addReply);
    fixture.assets.forEach(addReply);
    const slug = new URL(fixture.channel_url).pathname.split("/").at(-1)!;
    const client = new ArenaClient({
      fetch: stubFetch(replies),
      now: () => new Date(fixture.retrieved_at),
    });

    const captured = await client.fetchChannelCapture(slug);
    const parsed = parseArenaCapture(captured);
    expect(parsed).toEqual(parseArenaCapture(fixtureBytes));
    expect(verifyArena(parsed)).toMatchObject({
      ok: true,
      candidate_count: 5,
      element_count: 9,
    });
  });

  test("captures mixed blocks exactly, in source order, without crawling destinations", async () => {
    const imageUrl = "https://d2w9rnfcy7mm78.cloudfront.net/image-large.jpg";
    const redirectedImageUrl = "https://images.are.na/image-large.jpg";
    const linkPreviewUrl = "https://images.are.na/link-preview.jpg";
    const attachmentUrl = "https://attachments.are.na/report.pdf";
    const embedPreviewUrl = "https://images.are.na/embed-preview.webp";
    const page2Url = `https://api.are.na/v3/channels/${SLUG}/contents?per=100&page=2&sort=position_desc`;
    const channel = `${channelBody(6, 5, 1)}\n`;
    const page1 = `${pageBody(
      [
        block(101, "Text", { connection: { position: 60 }, content: "**hello**" }),
        block(102, "Image", {
          connection: { position: 50 },
          image: { large: { src: imageUrl } },
        }),
        block(103, "Link", {
          connection: { position: 40 },
          source: { url: "https://example.test/article" },
          image: { large: { src: linkPreviewUrl } },
        }),
      ],
      { hasMorePages: true, totalCount: 6, totalPages: 2 },
    )}\n`;
    const page2 = `${pageBody(
      [
        block(104, "Attachment", {
          connection: { position: 30 },
          attachment: { url: attachmentUrl, content_type: "application/pdf" },
        }),
        block(105, "Embed", {
          connection: { position: 20 },
          embed: { url: "https://video.example.test/watch/5", html: "<iframe>ignored</iframe>" },
          image: { large: { src: embedPreviewUrl } },
        }),
        {
          id: 201,
          base_type: "Channel",
          type: "Channel",
          state: "available",
          connection: { position: 10 },
        },
      ],
      {
        currentPage: 2,
        hasMorePages: false,
        totalCount: 6,
        totalPages: 2,
      },
    )}\n`;
    const requests: Request[] = [];
    const fetch = stubFetch(
      new Map([
        [CHANNEL_URL, [{ body: channel, headers: { "Content-Type": "application/json" } }]],
        [PAGE_1_URL, [{ body: page1, headers: { "Content-Type": "application/json" } }]],
        [page2Url, [{ body: page2, headers: { "Content-Type": "application/json" } }]],
        [
          imageUrl,
          [
            {
              status: 307,
              headers: { Location: redirectedImageUrl },
            },
          ],
        ],
        [redirectedImageUrl, [{ body: "image-body", headers: { "Content-Type": "image/jpeg" } }]],
        [
          linkPreviewUrl,
          [{ body: "link-body", headers: { "Content-Type": "image/jpeg; charset=binary" } }],
        ],
        [attachmentUrl, [{ body: "%PDF", headers: { "Content-Type": "application/pdf" } }]],
        [embedPreviewUrl, [{ body: "embed-body", headers: { "Content-Type": "image/webp" } }]],
      ]),
      requests,
    );
    const client = new ArenaClient({
      fetch,
      now: () => new Date("2026-08-29T12:34:56.000Z"),
    });

    const captureText = new TextDecoder().decode(await client.fetchChannelCapture(SLUG));
    const expected = {
      version: "arena-capture@1",
      channel_url: "https://www.are.na/test-owner/mixed-media",
      retrieved_at: "2026-08-29T12:34:56.000Z",
      channel: {
        url: CHANNEL_URL,
        content_type: "application/json",
        body_base64: base64(channel),
      },
      contents_pages: [
        {
          url: PAGE_1_URL,
          content_type: "application/json",
          body_base64: base64(page1),
        },
        {
          url: page2Url,
          content_type: "application/json",
          body_base64: base64(page2),
        },
      ],
      assets: [
        {
          url: redirectedImageUrl,
          content_type: "image/jpeg",
          body_base64: base64("image-body"),
          block_id: 102,
          redirects: [
            {
              status: 307,
              from_url: imageUrl,
              location: redirectedImageUrl,
              to_url: redirectedImageUrl,
            },
          ],
          requested_url: imageUrl,
          role: "content",
        },
        {
          url: linkPreviewUrl,
          content_type: "image/jpeg",
          body_base64: base64("link-body"),
          block_id: 103,
          redirects: [],
          requested_url: linkPreviewUrl,
          role: "preview",
        },
        {
          url: attachmentUrl,
          content_type: "application/pdf",
          body_base64: base64("%PDF"),
          block_id: 104,
          redirects: [],
          requested_url: attachmentUrl,
          role: "content",
        },
        {
          url: embedPreviewUrl,
          content_type: "image/webp",
          body_base64: base64("embed-body"),
          block_id: 105,
          redirects: [],
          requested_url: embedPreviewUrl,
          role: "preview",
        },
      ],
    };
    expect(captureText).toBe(JSON.stringify(expected));
    expect(requests.map(({ url }) => url)).toEqual([
      CHANNEL_URL,
      PAGE_1_URL,
      page2Url,
      imageUrl,
      redirectedImageUrl,
      linkPreviewUrl,
      attachmentUrl,
      embedPreviewUrl,
    ]);
    expect(requests.slice(0, 3).map(({ redirect }) => redirect)).toEqual([
      "error",
      "error",
      "error",
    ]);
    expect(requests.slice(3).every(({ redirect }) => redirect === "manual")).toBe(true);
    expect(requests[0]?.headers.get("Accept")).toBe("application/json");
    expect(requests[3]?.headers.get("Accept")).toBe("*/*");
    expect(requests.some(({ url }) => url.includes("example.test"))).toBe(false);
  });

  test("rejects unsafe asset sources and unsafe redirect targets", async () => {
    const unsafeBlock = block(101, "Image", {
      image: { large: { src: "https://example.test/private" } },
    });
    const unsafeSource = twoResponseClient(channelBody(1), pageBody([unsafeBlock]));
    await expect(unsafeSource.client.fetchChannelCapture(SLUG)).rejects.toMatchObject({
      kind: "unsafe_endpoint",
    });
    expect(unsafeSource.requests).toHaveLength(2);

    const imageUrl = "https://images.are.na/preview.jpg";
    const requests: Request[] = [];
    const redirectClient = new ArenaClient({
      fetch: stubFetch(
        new Map([
          [
            CHANNEL_URL,
            [{ body: channelBody(1), headers: { "Content-Type": "application/json" } }],
          ],
          [
            PAGE_1_URL,
            [
              {
                body: pageBody([block(102, "Image", { image: { large: { src: imageUrl } } })]),
                headers: { "Content-Type": "application/json" },
              },
            ],
          ],
          [imageUrl, [{ status: 302, headers: { Location: "http://127.0.0.1/metadata" } }]],
        ]),
        requests,
      ),
    });
    await expect(redirectClient.fetchChannelCapture(SLUG)).rejects.toMatchObject({
      kind: "unsafe_endpoint",
    });
    expect(requests).toHaveLength(3);
  });

  test("fails closed on malformed API status, JSON, top-level shape, and page metadata", async () => {
    const rejected = new ArenaClient({
      fetch: async () => new Response("busy", { status: 202 }),
    });
    await expect(rejected.fetchChannelCapture(SLUG)).rejects.toMatchObject({
      kind: "provider_rejected",
    });

    const malformedJson = new ArenaClient({
      fetch: async () => jsonResponse("{"),
    });
    await expect(malformedJson.fetchChannelCapture(SLUG)).rejects.toMatchObject({
      kind: "invalid_response",
    });

    const arrayResponse = new ArenaClient({
      fetch: async () => jsonResponse("[]"),
    });
    await expect(arrayResponse.fetchChannelCapture(SLUG)).rejects.toMatchObject({
      kind: "invalid_response",
    });

    const badPage = twoResponseClient(
      channelBody(0),
      pageBody([], { currentPage: 2, totalPages: 1 }),
    );
    await expect(badPage.client.fetchChannelCapture(SLUG)).rejects.toMatchObject({
      kind: "invalid_response",
      message: expect.stringContaining("pagination"),
    });
  });

  test("rejects unavailable, duplicate, and unsupported contents before fetching assets", async () => {
    const cases: Array<{ name: string; records: JsonRecord[] }> = [
      {
        name: "unavailable",
        records: [{ ...block(1, "Text"), state: "pending" }],
      },
      {
        name: "duplicate",
        records: [block(1, "Text"), block(1, "Text")],
      },
      {
        name: "unsupported",
        records: [block(1, "Mystery")],
      },
    ];

    for (const sample of cases) {
      const { client, requests } = twoResponseClient(
        channelBody(sample.records.length),
        pageBody(sample.records),
      );
      await expect(client.fetchChannelCapture(SLUG), sample.name).rejects.toMatchObject({
        kind: "invalid_response",
      });
      expect(requests, sample.name).toHaveLength(2);
    }
  });

  test("enforces API, asset, total, page, content, and redirect bounds", async () => {
    const oversizedApi = twoResponseClient(channelBody(0), pageBody([]), {
      maxApiResponseBytes: 4,
    });
    await expect(oversizedApi.client.fetchChannelCapture(SLUG)).rejects.toMatchObject({
      kind: "response_too_large",
    });

    const oversizedTotal = twoResponseClient(channelBody(0), pageBody([]), {
      maxTotalBytes: 4,
    });
    await expect(oversizedTotal.client.fetchChannelCapture(SLUG)).rejects.toMatchObject({
      kind: "response_too_large",
    });

    const tooManyPages = twoResponseClient(
      channelBody(1),
      pageBody([block(1, "Text")], {
        hasMorePages: true,
        totalPages: 2,
      }),
      { maxPages: 1 },
    );
    await expect(tooManyPages.client.fetchChannelCapture(SLUG)).rejects.toMatchObject({
      kind: "limit_exceeded",
    });

    const tooManyContents = twoResponseClient(channelBody(2), pageBody([]), {
      maxBlocks: 1,
    });
    await expect(tooManyContents.client.fetchChannelCapture(SLUG)).rejects.toMatchObject({
      kind: "limit_exceeded",
    });

    const imageUrl = "https://images.are.na/full.jpg";
    const assetReplies = new Map<string, StubResponse[]>([
      [CHANNEL_URL, [{ body: channelBody(1), headers: { "Content-Type": "application/json" } }]],
      [
        PAGE_1_URL,
        [
          {
            body: pageBody([block(1, "Image", { image: { large: { src: imageUrl } } })]),
            headers: { "Content-Type": "application/json" },
          },
        ],
      ],
      [imageUrl, [{ body: "12345", headers: { "Content-Type": "image/jpeg" } }]],
    ]);
    const oversizedAsset = new ArenaClient({
      fetch: stubFetch(assetReplies),
      maxAssetBytes: 4,
    });
    await expect(oversizedAsset.fetchChannelCapture(SLUG)).rejects.toMatchObject({
      kind: "response_too_large",
    });

    const redirectReplies = new Map<string, StubResponse[]>([
      [CHANNEL_URL, [{ body: channelBody(1), headers: { "Content-Type": "application/json" } }]],
      [
        PAGE_1_URL,
        [
          {
            body: pageBody([block(1, "Image", { image: { large: { src: imageUrl } } })]),
            headers: { "Content-Type": "application/json" },
          },
        ],
      ],
      [imageUrl, [{ status: 307, headers: { Location: "/other.jpg" } }]],
    ]);
    const noRedirects = new ArenaClient({
      fetch: stubFetch(redirectReplies),
      maxRedirects: 0,
    });
    await expect(noRedirects.fetchChannelCapture(SLUG)).rejects.toMatchObject({
      kind: "provider_rejected",
    });
  });

  test("uses one deadline for API fetches and rejects invalid slugs without network access", async () => {
    let signal: AbortSignal | null = null;
    const client = new ArenaClient({
      requestTimeoutMs: 10,
      fetch: async (_input, init) => {
        signal = init?.signal ?? null;
        return new Promise<Response>(() => undefined);
      },
    });
    await expect(client.fetchChannelCapture(SLUG)).rejects.toMatchObject({
      kind: "request_timeout",
    });
    expect((signal as AbortSignal | null)?.aborted).toBe(true);

    let called = false;
    const invalidSlug = new ArenaClient({
      fetch: async () => {
        called = true;
        return jsonResponse("{}");
      },
    });
    await expect(invalidSlug.fetchChannelCapture("../private")).rejects.toMatchObject({
      kind: "invalid_channel_slug",
    });
    await expect(
      invalidSlug.fetchChannelCapture("a".repeat(ARENA_CHANNEL_SLUG_MAX_LENGTH + 1)),
    ).rejects.toMatchObject({ kind: "invalid_channel_slug" });
    expect(called).toBe(false);
  });
});
