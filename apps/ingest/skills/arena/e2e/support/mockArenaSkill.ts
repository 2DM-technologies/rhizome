import type { MediaElement, MediaObject } from "@rnet/types";

import {
  OWNER_ID,
  type MockSourceSkillAdapter,
  type MockStagedElement,
} from "@rhizome/test-support/mockStore";
import { parseArenaSourceConfig } from "../../contracts.ts";
import arenaCaptureFixture from "../../fixtures/mixed-channel-capture.json";
import { arenaSourceSkillManifest } from "../../manifest.ts";
import { arenaParser } from "../../scripts/parse-arena.ts";
import { verifyArena } from "../../verify.ts";

export const ARENA_IMPORT_SOURCE_ID = "0198f2a1-0a01-7a01-8a01-000000000001";
export const ARENA_IMPORT_OPERATION_ID = "0198f2a1-0b01-7b01-8b01-000000000001";
export const ARENA_ORIGIN_ID = "0198f2a1-0c01-7c01-8c01-000000000001";

export const ARENA_CHANNEL_URL = arenaCaptureFixture.channel_url;

export const mockArenaSourceSkill = {
  manifest: arenaSourceSkillManifest,
  operationId: ARENA_IMPORT_OPERATION_ID,
  sourceId: ARENA_IMPORT_SOURCE_ID,
  capture: (context) =>
    context.save({
      id: ARENA_ORIGIN_ID,
      payload: JSON.stringify(arenaCaptureFixture),
      contentHash: `sha256:${"f".repeat(64)}`,
      label: "arena-mixed-channel-capture.json",
      mime: "application/vnd.rhizome.arena-capture+json",
    }),
  normalizeConfig(input) {
    try {
      return { ok: true, value: { ...parseArenaSourceConfig(input) } };
    } catch {
      return { ok: false, detail: "Enter a public Are.na channel URL" };
    }
  },
  async stage({ origin }) {
    const parsed = await arenaParser.parse(origin.payload);
    const candidates: MediaObject[] = [];
    const elements: MockStagedElement[] = [];
    for (const [blockIndex, block] of parsed.blocks.entries()) {
      const objectId = indexedUuid("0198f2a1-0d01-7d01-8d01-000000000000", blockIndex);
      const elementReferences: MediaObject["elements"] = [];
      for (const [elementIndex, element] of block.elements.entries()) {
        const elementId = indexedUuid(
          "0198f2a1-0e01-7e01-8e01-000000000000",
          blockIndex * 10 + elementIndex,
        );
        const uri = `rnet://element/${elementId}` as const;
        const document = {
          rnet_schema: "0.1",
          kind: element.kind,
          uri,
          owner: `rnet://id/${OWNER_ID}`,
          content_hash: element.contentHash,
          mime: element.mime,
          bytes: `http://127.0.0.1/rnet/v0/elements/${elementId}/bytes`,
          byte_size: element.byteSize,
          ...(element.alt ? { alt: element.alt } : {}),
          created_at: parsed.retrievedAt,
        } satisfies MediaElement;
        elementReferences.push({
          uri,
          role: element.role,
        });
        elements.push({
          document,
          object_uri: `rnet://object/${objectId}`,
          preview_url: `/rnet/v0/operations/${ARENA_IMPORT_OPERATION_ID}/elements/${elementId}/bytes`,
          role: element.role,
          ...(element.alt ? { alt: element.alt } : {}),
          payload: Buffer.from(element.bytes),
        });
      }
      candidates.push({
        rnet_schema: "0.1",
        uri: `rnet://object/${objectId}`,
        owner: `rnet://id/${OWNER_ID}`,
        type: "arena.block",
        elements: elementReferences,
        keys: block.keys,
        source: {
          ingest: { method: "parser", reproducible: true, skill: "arena@0.0.0-test" },
          origins: [origin.document.uri],
          properties: block.sourceProperties,
        },
      });
    }
    return {
      candidates,
      destination: { title: parsed.channelTitle },
      elements,
      verification: { ...verifyArena(parsed), totals_by_currency: {} },
    };
  },
} satisfies MockSourceSkillAdapter;

function indexedUuid(namespace: string, index: number): string {
  return `${namespace.slice(0, -12)}${String(index + 1).padStart(12, "0")}`;
}
