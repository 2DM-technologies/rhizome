import { describe, expect, test } from "bun:test";
import {
  ARENA_CHANNEL_SLUG_MAX_LENGTH,
  ARENA_PARSER_NAME,
  ARENA_PROVIDER,
} from "@rhizome/store-contract";

import type { DbIngestionSource } from "../src/db/models/ingestion-source.ts";
import {
  IngestionSourcesService,
  normalizeArenaChannelSlug,
  serializeIngestionSource,
} from "../src/services/ingestion-source-service.ts";
import type { Database } from "../src/db/index.ts";

describe("Are.na remote ingestion source", () => {
  test("normalizes a public channel URL or an existing slug", () => {
    expect(normalizeArenaChannelSlug("love-always-wins")).toBe("love-always-wins");
    expect(normalizeArenaChannelSlug("  love-always-wins  ")).toBe("love-always-wins");
    expect(
      normalizeArenaChannelSlug(
        "https://www.are.na/noah-putnam/love-always-wins/?utm_source=copy#channel",
      ),
    ).toBe("love-always-wins");
    expect(normalizeArenaChannelSlug("https://are.na/noah-putnam/123456")).toBe("123456");
  });

  test("refuses arbitrary or malformed URLs instead of persisting them", () => {
    for (const locator of [
      "https://example.com/noah-putnam/love-always-wins",
      "http://www.are.na/noah-putnam/love-always-wins",
      "https://www.are.na/noah-putnam/love-always-wins/blocks",
      "https://user:password@www.are.na/noah-putnam/love-always-wins",
      "https://www.are.na:444/noah-putnam/love-always-wins",
      "LOVE ALWAYS WINS",
      "love_always_wins",
    ]) {
      expect(() => normalizeArenaChannelSlug(locator)).toThrow("public https://www.are.na");
    }
  });

  test("rejects an overlong slug during source normalization", () => {
    const maximumSlug = "a".repeat(ARENA_CHANNEL_SLUG_MAX_LENGTH);
    const overlongSlug = `${maximumSlug}a`;
    expect(normalizeArenaChannelSlug(maximumSlug)).toBe(maximumSlug);
    expect(normalizeArenaChannelSlug(`https://www.are.na/noah-putnam/${maximumSlug}`)).toBe(
      maximumSlug,
    );
    expect(() => normalizeArenaChannelSlug(overlongSlug)).toThrow("public https://www.are.na");
    expect(() =>
      normalizeArenaChannelSlug(`https://www.are.na/noah-putnam/${overlongSlug}`),
    ).toThrow("public https://www.are.na");
  });

  test("rejects an overlong slug while creating the source, before persistence", async () => {
    let databaseTouched = false;
    const db = new Proxy({} as Database, {
      get() {
        databaseTouched = true;
        throw new Error("Database must not be touched");
      },
    });
    const ownerUuid = "0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47";
    const service = new IngestionSourcesService({
      db,
      actor: { kind: "user", uuid: ownerUuid, subject: `id:rnet://id/${ownerUuid}` },
    });

    await expect(
      service.create({
        provider: ARENA_PROVIDER,
        channel_url: "a".repeat(ARENA_CHANNEL_SLUG_MAX_LENGTH + 1),
      }),
    ).rejects.toThrow("public https://www.are.na");
    expect(databaseTouched).toBe(false);
  });

  test("serializes only the normalized remote locator", () => {
    const source = remoteSource();
    expect(serializeIngestionSource(source)).toEqual({
      source: `source:${source.uuid}`,
      kind: "remote",
      provider: ARENA_PROVIDER,
      parser: ARENA_PARSER_NAME,
      parser_version: "arena@1.1.0",
      config: { channel_slug: "love-always-wins" },
      created_at: "2026-08-29T12:00:00.000Z",
    });
    expect(JSON.stringify(serializeIngestionSource(source))).not.toContain("channel_url");
  });

  test("rejects internally inconsistent remote rows", () => {
    expect(() =>
      serializeIngestionSource(
        remoteSource({ originUuid: "0198f2a1-a001-7a01-8001-000000000001" }),
      ),
    ).toThrow("internally inconsistent");
    expect(() => serializeIngestionSource(remoteSource({ provider: null }))).toThrow(
      "internally inconsistent",
    );
    expect(() =>
      serializeIngestionSource(
        remoteSource({
          config: { channel_slug: "love-always-wins", request_url: "https://evil.test" },
        }),
      ),
    ).toThrow("internally inconsistent");
  });
});

function remoteSource(overrides: Partial<DbIngestionSource> = {}): DbIngestionSource {
  return {
    uuid: "0198f2a1-a000-7a00-8000-000000000000",
    ownerUuid: "0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47",
    kind: "remote",
    provider: ARENA_PROVIDER,
    parser: ARENA_PARSER_NAME,
    parserVersion: "arena@1.1.0",
    originUuid: null,
    credentialUuid: null,
    config: { channel_slug: "love-always-wins" },
    createdAt: new Date("2026-08-29T12:00:00.000Z"),
    revokedAt: null,
    ...overrides,
  };
}
