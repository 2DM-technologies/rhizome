import { createHash } from "node:crypto";

import type {
  ArenaBlockType,
  ArenaElementKind,
  ParsedArenaBlock,
  ParsedArenaChannel,
  ParsedArenaElement,
} from "../skills/arena/scripts/parse-arena.ts";

export type ArenaVerifyCheckName =
  | "non_empty"
  | "record_count"
  | "object_count"
  | "required_fields"
  | "unique_block_ids"
  | "connection_order"
  | "element_accounting"
  | "element_integrity";

export interface ArenaVerifyCheck {
  name: ArenaVerifyCheckName;
  ok: boolean;
  detail: string;
}

export interface ArenaVerifyReport {
  ok: boolean;
  source_record_count: number;
  candidate_count: number;
  nested_channel_count: number;
  element_count: number;
  total_element_bytes: number;
  counts_by_block_type: Partial<Record<ArenaBlockType, number>>;
  counts_by_element_kind: Partial<Record<ArenaElementKind, number>>;
  checks: ArenaVerifyCheck[];
}

const HASH = /^sha256:[a-f0-9]{64}$/;
const MIME = /^[a-z]+\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

export function verifyArena(parsed: ParsedArenaChannel): ArenaVerifyReport {
  const blockCounts = new Map<ArenaBlockType, number>();
  const elementCounts = new Map<ArenaElementKind, number>();
  const blockIds = new Set<string>();
  let uniqueBlockIds = true;
  let requiredFields = true;
  let elementAccounting = true;
  let elementIntegrity = true;
  let totalElementBytes = 0;
  let elementCount = 0;
  let previousBlockPosition = 0;

  for (const block of parsed.blocks) {
    blockCounts.set(block.blockType, (blockCounts.get(block.blockType) ?? 0) + 1);
    if (blockIds.has(block.blockId)) uniqueBlockIds = false;
    blockIds.add(block.blockId);
    const numericBlockId = Number(block.blockId);
    requiredFields &&=
      Number.isSafeInteger(numericBlockId) &&
      numericBlockId > 0 &&
      Boolean(block.title.trim()) &&
      Number.isSafeInteger(block.position) &&
      block.position > 0 &&
      block.position > previousBlockPosition &&
      block.keys.arena_block_id === block.blockId &&
      block.keys.arena_channel_id === parsed.channelId &&
      block.sourceProperties.arena_block_type === block.blockType &&
      block.sourceProperties.connection_position === block.position;
    previousBlockPosition = block.position;

    elementAccounting &&= hasExpectedElements(block);
    for (const element of block.elements) {
      elementCount += 1;
      elementCounts.set(element.kind, (elementCounts.get(element.kind) ?? 0) + 1);
      const byteLength = element.bytes.byteLength;
      totalElementBytes += byteLength;
      elementIntegrity &&=
        byteLength > 0 &&
        element.byteSize === byteLength &&
        Number.isSafeInteger(element.byteSize) &&
        HASH.test(element.contentHash) &&
        element.contentHash === hash(element.bytes) &&
        MIME.test(element.mime) &&
        mimeMatchesKind(element);
    }
  }

  const sourcePositionsValid =
    parsed.sourcePositions.length === parsed.sourceRecordCount &&
    parsed.sourcePositions.every(
      (position, index) =>
        Number.isSafeInteger(position) &&
        position > 0 &&
        (index === 0 || position > parsed.sourcePositions[index - 1]!),
    ) &&
    parsed.blocks.every((block) => parsed.sourcePositions.includes(block.position));
  const recordCountValid =
    Number.isSafeInteger(parsed.sourceRecordCount) &&
    parsed.sourceRecordCount >= 0 &&
    Number.isSafeInteger(parsed.nestedChannelCount) &&
    parsed.nestedChannelCount >= 0 &&
    Number.isSafeInteger(parsed.declaredNestedChannelCount) &&
    parsed.declaredNestedChannelCount >= 0 &&
    parsed.sourceRecordCount === parsed.declaredContentCount &&
    parsed.sourceRecordCount === parsed.blocks.length + parsed.nestedChannelCount &&
    parsed.nestedChannelCount === parsed.declaredNestedChannelCount;
  const objectCountValid =
    Number.isSafeInteger(parsed.declaredBlockCount) &&
    parsed.declaredBlockCount >= 0 &&
    parsed.blocks.length === parsed.declaredBlockCount;
  const nonEmpty = parsed.blocks.length > 0;
  requiredFields &&=
    /^[1-9][0-9]*$/.test(parsed.channelId) &&
    Boolean(parsed.channelSlug.trim()) &&
    Boolean(parsed.channelTitle.trim()) &&
    parsed.channelUrl.startsWith("https://www.are.na/") &&
    Number.isFinite(Date.parse(parsed.retrievedAt));

  const checks: ArenaVerifyCheck[] = [
    {
      name: "non_empty",
      ok: nonEmpty,
      detail: nonEmpty
        ? `${parsed.blocks.length} importable top-level blocks`
        : "No importable top-level blocks",
    },
    {
      name: "record_count",
      ok: recordCountValid,
      detail: `${parsed.sourceRecordCount} top-level source records: ${parsed.blocks.length} blocks and ${parsed.nestedChannelCount} nested channels`,
    },
    {
      name: "object_count",
      ok: objectCountValid,
      detail: `${parsed.blocks.length} candidates from ${parsed.declaredBlockCount} declared blocks`,
    },
    {
      name: "required_fields",
      ok: requiredFields,
      detail: requiredFields
        ? "Every candidate preserves its channel, block type, stable ID, title, and connection position"
        : "A candidate is missing or contradicts required channel/block metadata",
    },
    {
      name: "unique_block_ids",
      ok: uniqueBlockIds,
      detail: uniqueBlockIds
        ? "Are.na block IDs are unique"
        : "An Are.na block ID appears more than once",
    },
    {
      name: "connection_order",
      ok: sourcePositionsValid,
      detail: sourcePositionsValid
        ? "Top-level source and candidate connection order is strictly ascending"
        : "Top-level source or candidate connection order is missing, duplicate, or inconsistent",
    },
    {
      name: "element_accounting",
      ok: elementAccounting,
      detail: elementAccounting
        ? `${elementCount} elements match their block types and roles`
        : "A block has missing, extra, or incorrectly-role-tagged elements",
    },
    {
      name: "element_integrity",
      ok: elementIntegrity && Number.isSafeInteger(totalElementBytes),
      detail:
        elementIntegrity && Number.isSafeInteger(totalElementBytes)
          ? `${elementCount} element payloads cover ${totalElementBytes} bytes with matching MIME, kind, size, and SHA-256`
          : "An element has invalid MIME/kind, byte size, or SHA-256 evidence",
    },
  ];

  return {
    ok: checks.every((check) => check.ok),
    source_record_count: parsed.sourceRecordCount,
    candidate_count: parsed.blocks.length,
    nested_channel_count: parsed.nestedChannelCount,
    element_count: elementCount,
    total_element_bytes: totalElementBytes,
    counts_by_block_type: sortedCounts(blockCounts),
    counts_by_element_kind: sortedCounts(elementCounts),
    checks,
  };
}

function hasExpectedElements(block: ParsedArenaBlock): boolean {
  if (block.blockType === "Text") {
    return (
      block.elements.length === 1 &&
      block.elements[0]?.role === "content" &&
      block.elements[0].kind === "text" &&
      block.elements[0].mime === "text/markdown"
    );
  }
  if (block.blockType === "Image") {
    return (
      block.elements.length === 1 &&
      block.elements[0]?.role === "content" &&
      block.elements[0].kind === "image"
    );
  }
  if (block.blockType === "Attachment") {
    return (
      block.elements.length === 1 &&
      block.elements[0]?.role === "content" &&
      block.elements[0].mime === block.sourceProperties.attachment_content_type
    );
  }
  return (
    block.elements.length === 0 ||
    (block.elements.length === 1 &&
      block.elements[0]?.role === "preview" &&
      block.elements[0].kind === "image")
  );
}

function mimeMatchesKind(element: ParsedArenaElement): boolean {
  if (element.kind === "text") return element.mime === "text/markdown";
  if (element.kind === "image") return element.mime.startsWith("image/");
  if (element.kind === "audio") return element.mime.startsWith("audio/");
  if (element.kind === "video") return element.mime.startsWith("video/");
  return element.mime.startsWith("application/") || element.mime.startsWith("text/");
}

function hash(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sortedCounts<Key extends string>(counts: Map<Key, number>): Partial<Record<Key, number>> {
  const sorted: Partial<Record<Key, number>> = {};
  for (const [key, count] of [...counts].sort(([left], [right]) => left.localeCompare(right))) {
    sorted[key] = count;
  }
  return sorted;
}
