import { describe, expect, test } from "bun:test";

import { ARENA_CHANNEL_SLUG_MAX_LENGTH, ARENA_PARSER_NAME } from "./contracts.ts";

import {
  ARENA_CAPTURE_VERSION,
  ARENA_PARSER_VERSION,
  arenaParser,
  parseArenaCapture,
  type ArenaCaptureV1,
  type CapturedArenaResponse,
} from "./scripts/parse-arena.ts";
import { verifyArena } from "./verify.ts";

const ORIGINAL_IMAGE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlDoAAAAASUVORK5CYII=";
const LARGE_RENDITION_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("M2 committed Are.na v3 parser", () => {
  test("parses the synthetic mixed channel deterministically with element payloads", async () => {
    const bytes = await fixtureBytes();
    const first = parseArenaCapture(bytes);
    const second = await arenaParser.parse(bytes);

    expect(first).toEqual(second);
    expect(ARENA_CAPTURE_VERSION).toBe("arena-capture@1");
    expect(ARENA_PARSER_NAME).toBe("arena");
    expect(ARENA_PARSER_VERSION).toBe("arena@1.2.0");
    expect(arenaParser.name).toBe(ARENA_PARSER_NAME);
    expect(first).toMatchObject({
      channelId: "7001",
      channelSlug: "synthetic-media-study",
      channelTitle: "Synthetic Media Study",
      channelDescription: "A synthetic mixed-media channel.",
      sourceRecordCount: 5,
      nestedChannelCount: 0,
      sourcePositions: [5, 4, 3, 2, 1],
    });
    expect(
      first.blocks.map(({ blockId, blockType, position }) => [blockId, blockType, position]),
    ).toEqual([
      ["1101", "Text", 5],
      ["1102", "Image", 4],
      ["1103", "Link", 3],
      ["1104", "Attachment", 2],
      ["1105", "Embed", 1],
    ]);

    const [text, image, link, attachment, embed] = first.blocks;
    for (const block of first.blocks) {
      expect(block.elements[0]).toMatchObject({
        role: "title",
        kind: "text",
        mime: "text/plain",
        filename: `arena-${block.blockId}-title.txt`,
      });
      expect(new TextDecoder().decode(block.elements[0]!.bytes)).toBe(block.title);
    }
    expect(new TextDecoder().decode(text?.elements[1]?.bytes)).toBe(
      "## Notice what connects\n\nA **synthetic** note with [context](https://example.test/context).",
    );
    expect(text?.elements[1]).toMatchObject({
      role: "content",
      kind: "text",
      mime: "text/markdown",
      byteSize: 91,
      filename: "arena-1101.md",
    });
    expect(image?.elements[1]).toMatchObject({
      role: "content",
      kind: "image",
      mime: "image/png",
      byteSize: 68,
      contentHash: "sha256:cce5b145575b2e1d0b0b388d3eace85093518c6240834b0c9e093b568f493152",
      sourceUrl: "https://d2w9rnfcy7mm78.cloudfront.net/synthetic/primary/original.png",
    });
    expect([...image!.elements[1]!.bytes]).toEqual([
      ...Buffer.from(ORIGINAL_IMAGE_PNG_BASE64, "base64"),
    ]);
    expect([...image!.elements[1]!.bytes]).not.toEqual([
      ...Buffer.from(LARGE_RENDITION_PNG_BASE64, "base64"),
    ]);
    expect(image?.sourceProperties).toMatchObject({
      original_asset_url: "https://d2w9rnfcy7mm78.cloudfront.net/synthetic/primary/original.png",
      imported_asset_url: "https://d2w9rnfcy7mm78.cloudfront.net/synthetic/primary/original.png",
    });
    expect(link?.elements[1]).toMatchObject({ role: "preview", kind: "image" });
    expect(link?.sourceProperties).toMatchObject({
      source_url: "https://example.test/article",
      connection_position: 3,
      author: { id: 70001, name: "Synthetic Author", slug: "synthetic-author" },
    });
    expect(attachment?.elements[1]).toMatchObject({
      role: "content",
      kind: "document",
      mime: "application/pdf",
      byteSize: 76,
      filename: "synthetic-field-notes.pdf",
    });
    expect(embed?.elements).toHaveLength(1);
    expect(embed?.sourceProperties).toMatchObject({
      source_url: "https://video.example.test/watch/synthetic",
      embed_url: "https://video.example.test/embed/synthetic",
      embed_source_url: "https://video.example.test/watch/synthetic",
      embed_type: "video",
    });
    expect(JSON.stringify(embed?.sourceProperties)).not.toContain("iframe");
    for (const block of first.blocks) {
      for (const element of block.elements) {
        expect(element.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      }
    }
  });

  test("passes VERIFY with block, order, MIME, hash, and byte evidence", async () => {
    const parsed = parseArenaCapture(await fixtureBytes());
    expect(verifyArena(parsed)).toEqual({
      ok: true,
      source_record_count: 5,
      candidate_count: 5,
      nested_channel_count: 0,
      element_count: 9,
      total_element_bytes: 407,
      counts_by_block_type: { Attachment: 1, Embed: 1, Image: 1, Link: 1, Text: 1 },
      counts_by_element_kind: { document: 1, image: 2, text: 6 },
      checks: expect.arrayContaining([
        expect.objectContaining({ name: "record_count", ok: true }),
        expect.objectContaining({ name: "connection_order", ok: true }),
        expect.objectContaining({ name: "element_accounting", ok: true }),
        expect.objectContaining({ name: "element_integrity", ok: true }),
      ]),
    });
  });

  test("replays legacy ascending captures without changing the pinned parser version", async () => {
    const capture = await fixtureCapture();
    capture.contents_pages[0]!.url = capture.contents_pages[0]!.url.replace(
      "sort=position_desc",
      "sort=position_asc",
    );
    mutatePage(capture, (page) => {
      for (const [index, value] of array(page.data, "page data").entries()) {
        record(record(value, "block").connection, "connection").position = index + 1;
      }
    });

    const parsed = parseArenaCapture(captureBytes(capture));
    expect(parsed.sourcePositions).toEqual([1, 2, 3, 4, 5]);
    expect(parsed.blocks.map(({ blockId, position }) => [blockId, position])).toEqual([
      ["1101", 1],
      ["1102", 2],
      ["1103", 3],
      ["1104", 4],
      ["1105", 5],
    ]);
    expect(verifyArena(parsed)).toMatchObject({ ok: true });
  });

  test("accepts underscores in provider-issued channel slugs", async () => {
    const capture = await fixtureCapture();
    const slug = "synthetic-media_study";
    capture.channel_url = capture.channel_url.replace("synthetic-media-study", slug);
    capture.channel.url = capture.channel.url.replace("synthetic-media-study", slug);
    for (const page of capture.contents_pages) {
      page.url = page.url.replace("synthetic-media-study", slug);
    }
    const channelEnvelope = decodedBody(capture.channel);
    record(channelEnvelope.data ?? channelEnvelope, "channel").slug = slug;
    encodeBody(capture.channel, channelEnvelope);

    expect(parseArenaCapture(captureBytes(capture))).toMatchObject({ channelSlug: slug });
  });

  test("counts nested channels without traversing or emitting them", async () => {
    const capture = await fixtureCapture();
    const channel = decodedBody(capture.channel);
    const page = decodedBody(capture.contents_pages[0]!);
    const counts = record(record(channel.data, "channel").counts, "counts");
    counts.channels = 1;
    counts.contents = 6;
    const data = array(page.data, "page data");
    data.unshift({
      id: 2201,
      type: "Channel",
      slug: "nested-synthetic-channel",
      title: "Nested synthetic channel",
      state: "available",
      connection: {
        id: 72006,
        position: 6,
        pinned: false,
        connected_at: "2026-08-06T12:00:00Z",
        connected_by: null,
      },
    });
    const meta = record(page.meta, "page meta");
    meta.total_count = 6;
    encodeBody(capture.channel, channel);
    encodeBody(capture.contents_pages[0]!, page);

    const parsed = parseArenaCapture(captureBytes(capture));
    expect(parsed).toMatchObject({
      sourceRecordCount: 6,
      nestedChannelCount: 1,
      declaredNestedChannelCount: 1,
      sourcePositions: [6, 5, 4, 3, 2, 1],
    });
    expect(parsed.blocks).toHaveLength(5);
    expect(verifyArena(parsed)).toMatchObject({ ok: true, nested_channel_count: 1 });
  });

  test("emits the deterministic fallback title as the first text/plain element", async () => {
    const capture = await fixtureCapture();
    mutatePage(capture, (page) => {
      delete record(array(page.data, "data")[2], "block").title;
    });

    const block = parseArenaCapture(captureBytes(capture)).blocks[2]!;
    expect(block.title).toBe("Are.na link 1103");
    expect(block.elements[0]).toMatchObject({ role: "title", kind: "text", mime: "text/plain" });
    expect(new TextDecoder().decode(block.elements[0]!.bytes)).toBe("Are.na link 1103");
    expect(verifyArena(parseArenaCapture(captureBytes(capture))).ok).toBe(true);
  });

  test("rejects unavailable and duplicate blocks before candidate emission", async () => {
    const unavailable = await fixtureCapture();
    mutatePage(unavailable, (page) => {
      record(array(page.data, "data")[0], "block").state = "failed";
    });
    expect(() => parseArenaCapture(captureBytes(unavailable))).toThrow("block is unavailable");

    const duplicate = await fixtureCapture();
    const duplicateChannel = decodedBody(duplicate.channel);
    const duplicateCounts = record(record(duplicateChannel.data, "channel").counts, "counts");
    duplicateCounts.blocks = 6;
    duplicateCounts.contents = 6;
    encodeBody(duplicate.channel, duplicateChannel);
    mutatePage(duplicate, (page) => {
      const data = array(page.data, "data");
      const repeated = structuredClone(record(data[0], "block"));
      record(repeated.connection, "connection").position = 6;
      data.unshift(repeated);
      record(page.meta, "meta").total_count = 6;
    });
    expect(() => parseArenaCapture(captureBytes(duplicate))).toThrow(
      "Are.na block 1101 appeared twice",
    );
  });

  test("rejects missing, duplicate, unsafe, and block-inconsistent assets", async () => {
    const missingOriginal = await fixtureCapture();
    mutatePage(missingOriginal, (page) => {
      const imageBlock = record(array(page.data, "data")[1], "image block");
      delete record(imageBlock.image, "image").src;
    });
    expect(() => parseArenaCapture(captureBytes(missingOriginal))).toThrow("original image URL");

    const missing = await fixtureCapture();
    missing.assets = missing.assets.filter(({ block_id }) => block_id !== 1102);
    expect(() => parseArenaCapture(captureBytes(missing))).toThrow(
      "Are.na block 1102 is missing its captured content asset",
    );

    const duplicate = await fixtureCapture();
    duplicate.assets.push(structuredClone(duplicate.assets[0]!));
    expect(() => parseArenaCapture(captureBytes(duplicate))).toThrow("duplicates 1102:content");

    const unsafe = await fixtureCapture();
    unsafe.assets[0]!.requested_url = "http://127.0.0.1/copied.png";
    expect(() => parseArenaCapture(captureBytes(unsafe))).toThrow(
      "must be an HTTPS URL without credentials",
    );

    const inconsistent = await fixtureCapture();
    inconsistent.assets[0]!.requested_url = "https://images.are.na/synthetic/other/large.png";
    inconsistent.assets[0]!.url = "https://images.are.na/synthetic/other/large.png";
    expect(() => parseArenaCapture(captureBytes(inconsistent))).toThrow(
      "does not match a declared block rendition",
    );

    const resizedImage = await fixtureCapture();
    resizedImage.assets[0]!.requested_url = "https://images.are.na/synthetic/primary/large.png";
    resizedImage.assets[0]!.url = "https://images.are.na/synthetic/primary/large.png";
    resizedImage.assets[0]!.body_base64 = LARGE_RENDITION_PNG_BASE64;
    expect(() => parseArenaCapture(captureBytes(resizedImage))).toThrow(
      "captured image URL does not match its original asset",
    );

    const wrongMime = await fixtureCapture();
    wrongMime.assets.find(({ block_id }) => block_id === 1104)!.content_type = "image/png";
    expect(() => parseArenaCapture(captureBytes(wrongMime))).toThrow(
      "captured attachment MIME does not match",
    );
  });

  test("validates requested, redirect-chain, and final-response asset provenance", async () => {
    const redirected = await fixtureCapture();
    const asset = redirected.assets[0]!;
    const requestedUrl = asset.requested_url;
    const finalUrl = "https://images.are.na/synthetic/redirected/large.png";
    asset.url = finalUrl;
    asset.redirects = [
      {
        status: 302,
        from_url: requestedUrl,
        location: finalUrl,
        to_url: finalUrl,
      },
    ];

    const parsed = parseArenaCapture(captureBytes(redirected));
    expect(parsed.blocks[1]?.elements[1]?.sourceUrl).toBe(finalUrl);
    expect(parsed.blocks[1]?.sourceProperties.imported_asset_url).toBe(finalUrl);

    const brokenChain = structuredClone(redirected);
    brokenChain.assets[0]!.redirects[0]!.to_url =
      "https://images.are.na/synthetic/different/large.png";
    expect(() => parseArenaCapture(captureBytes(brokenChain))).toThrow(
      "location does not resolve to its captured target",
    );

    const missingRedirect = structuredClone(redirected);
    missingRedirect.assets[0]!.redirects = [];
    expect(() => parseArenaCapture(captureBytes(missingRedirect))).toThrow(
      "redirect chain does not end at its response URL",
    );

    const unsafeFinal = structuredClone(redirected);
    unsafeFinal.assets[0]!.url = "http://127.0.0.1/copied.png";
    expect(() => parseArenaCapture(captureBytes(unsafeFinal))).toThrow(
      "must be an HTTPS URL without credentials",
    );
  });

  test("accepts large canonical base64 responses without regex subject-size limits", async () => {
    const capture = await fixtureCapture();
    const channelBody = Buffer.from(capture.channel.body_base64, "base64");
    const paddedChannelBody = Buffer.concat([channelBody, Buffer.alloc(4_500_000, 0x20)]);
    capture.channel.body_base64 = paddedChannelBody.toString("base64");

    expect(parseArenaCapture(captureBytes(capture))).toMatchObject({ channelId: "7001" });
  });

  test("rejects incomplete framing, pagination, order, and unsupported block types", async () => {
    const base64 = await fixtureCapture();
    base64.channel.body_base64 = `${base64.channel.body_base64.slice(0, -1)}!`;
    expect(() => parseArenaCapture(captureBytes(base64))).toThrow("canonical base64");

    const pagination = await fixtureCapture();
    mutatePage(pagination, (page) => {
      record(page.meta, "meta").has_more_pages = true;
    });
    expect(() => parseArenaCapture(captureBytes(pagination))).toThrow("pagination is inconsistent");

    const order = await fixtureCapture();
    mutatePage(order, (page) => {
      record(record(array(page.data, "data")[1], "block").connection, "connection").position = 5;
    });
    expect(() => parseArenaCapture(captureBytes(order))).toThrow(
      "not in unique descending board order",
    );

    const unsupported = await fixtureCapture();
    mutatePage(unsupported, (page) => {
      record(array(page.data, "data")[0], "block").type = "PendingBlock";
    });
    expect(() => parseArenaCapture(captureBytes(unsupported))).toThrow(
      "unsupported type PendingBlock",
    );

    const overlongOwner = await fixtureCapture();
    overlongOwner.channel_url = `https://www.are.na/${"a".repeat(
      ARENA_CHANNEL_SLUG_MAX_LENGTH + 1,
    )}/synthetic-media-study`;
    expect(() => parseArenaCapture(captureBytes(overlongOwner))).toThrow(
      "must be /owner/channel-slug",
    );

    const mismatchedOwner = await fixtureCapture();
    mismatchedOwner.channel_url = mismatchedOwner.channel_url.replace(
      "synthetic-author",
      "different-owner",
    );
    expect(() => parseArenaCapture(captureBytes(mismatchedOwner))).toThrow("owner does not match");
  });

  test("VERIFY fails closed if staged element or object evidence changes after parsing", async () => {
    const parsed = parseArenaCapture(await fixtureBytes());
    parsed.blocks[0]!.elements[0]!.contentHash = `sha256:${"0".repeat(64)}`;
    parsed.blocks[0]!.elements[0]!.role = "content";
    parsed.blocks[1]!.position = 5;
    parsed.blocks[1]!.blockId = parsed.blocks[0]!.blockId;
    parsed.blocks[1]!.keys.arena_block_id = parsed.blocks[0]!.blockId;
    const report = verifyArena(parsed);

    expect(report.ok).toBe(false);
    for (const name of [
      "required_fields",
      "unique_block_ids",
      "element_accounting",
      "element_integrity",
    ] as const) {
      expect(report.checks).toContainEqual(expect.objectContaining({ name, ok: false }));
    }
  });
});

function fixture(): URL {
  return new URL("./fixtures/mixed-channel-capture.json", import.meta.url);
}

async function fixtureBytes(): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(fixture()).arrayBuffer());
}

async function fixtureCapture(): Promise<ArenaCaptureV1> {
  return JSON.parse(await Bun.file(fixture()).text()) as ArenaCaptureV1;
}

function captureBytes(capture: ArenaCaptureV1): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(capture));
}

function decodedBody(response: CapturedArenaResponse): Record<string, unknown> {
  return record(JSON.parse(Buffer.from(response.body_base64, "base64").toString("utf8")), "body");
}

function encodeBody(response: CapturedArenaResponse, body: Record<string, unknown>): void {
  response.body_base64 = Buffer.from(JSON.stringify(body)).toString("base64");
}

function mutatePage(
  capture: ArenaCaptureV1,
  mutate: (page: Record<string, unknown>) => void,
): void {
  const response = capture.contents_pages[0]!;
  const page = decodedBody(response);
  mutate(page);
  encodeBody(response, page);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} is not an array`);
  return value;
}
