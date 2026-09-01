import {
  isXHandle,
  type NormalizedXEntities,
  type NormalizedXMentionEntity,
  type NormalizedXTagEntity,
  type NormalizedXUrlEntity,
  type XTextSpan,
} from "./contracts.ts";

const MAX_ENTITY_URL_LENGTH = 8_192;
const MAX_ENTITY_LABEL_LENGTH = 256;
const MAX_STRUCTURED_ENTITIES = 1_024;
const MAX_OFFSETLESS_MATCH_WORK = 8_000_000;

export interface XUrlEntityInput {
  readonly url: string;
  readonly expandedUrl?: string;
  readonly start?: number;
  readonly end?: number;
}

export interface XMentionEntityInput {
  readonly username: string;
  readonly start?: number;
  readonly end?: number;
}

export interface XTagEntityInput {
  readonly tag: string;
  readonly start?: number;
  readonly end?: number;
}

export interface XEntitiesInput {
  readonly urls?: readonly XUrlEntityInput[];
  readonly mentions?: readonly XMentionEntityInput[];
  readonly hashtags?: readonly XTagEntityInput[];
  readonly cashtags?: readonly XTagEntityInput[];
}

/** Matches only provider-owned HTTPS post URLs and an exact status path segment. */
export function isXStatusUrl(value: string, postId: string): boolean {
  try {
    const url = new URL(value);
    const path = url.pathname.split("/").filter(Boolean);
    const statusIndex = path.lastIndexOf("status");
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      /(^|\.)((x)|(twitter))\.com$/iu.test(url.hostname) &&
      statusIndex >= 0 &&
      path[statusIndex + 1] === postId
    );
  } catch {
    return false;
  }
}

/** Normalizes provider entity dialects to exact-text, UTF-16-indexed X-family facts. */
export function normalizeXEntities(
  text: string,
  input: XEntitiesInput,
): NormalizedXEntities | undefined {
  const count = Object.values(input).reduce((total, values) => total + (values?.length ?? 0), 0);
  if (count === 0) return undefined;
  if (count > MAX_STRUCTURED_ENTITIES) {
    throw new Error("X post has too many structured entities");
  }
  for (const [index, value] of (input.urls ?? []).entries()) {
    assertEntityString(value.url, MAX_ENTITY_URL_LENGTH, `URL entity ${index + 1}`);
    if (value.expandedUrl !== undefined) {
      assertEntityString(
        value.expandedUrl,
        MAX_ENTITY_URL_LENGTH,
        `expanded URL entity ${index + 1}`,
      );
    }
  }
  for (const [index, value] of (input.mentions ?? []).entries()) {
    if (!isXHandle(value.username)) {
      throw new Error(`X mention entity ${index + 1} is invalid`);
    }
  }
  assertTagInputs(input.hashtags ?? [], "#", "hashtag");
  assertTagInputs(input.cashtags ?? [], "$", "cashtag");

  const normalizeSpan = createTextSpanNormalizer(text, [
    ...(input.urls ?? []).map((value) => ({ ...value, token: value.url })),
    ...(input.mentions ?? []).map((value) => ({ ...value, token: `@${value.username}` })),
    ...(input.hashtags ?? []).map((value) => ({ ...value, token: `#${value.tag}` })),
    ...(input.cashtags ?? []).map((value) => ({ ...value, token: `$${value.tag}` })),
  ]);
  const urls = (input.urls ?? []).map((value): NormalizedXUrlEntity => {
    const { start, end } = normalizeSpan(value.url, value.start, value.end);
    return {
      start,
      end,
      url: value.url,
      ...(value.expandedUrl ? { expanded_url: value.expandedUrl } : {}),
    };
  });
  const mentions = (input.mentions ?? []).map((value): NormalizedXMentionEntity => {
    return {
      ...normalizeSpan(`@${value.username}`, value.start, value.end),
      username: value.username,
    };
  });
  const hashtags = normalizeTagEntities(input.hashtags ?? [], "#", normalizeSpan);
  const cashtags = normalizeTagEntities(input.cashtags ?? [], "$", normalizeSpan);

  sortAndDedupeEntities(urls, (value) => `${value.url}\u0000${value.expanded_url ?? ""}`);
  sortAndDedupeEntities(mentions, (value) => value.username);
  sortAndDedupeEntities(hashtags, (value) => value.tag);
  sortAndDedupeEntities(cashtags, (value) => value.tag);
  assertNoEntityOverlap([
    ...urls.map((value) => ({ ...value, category: "URL" })),
    ...mentions.map((value) => ({ ...value, category: "mention" })),
    ...hashtags.map((value) => ({ ...value, category: "hashtag" })),
    ...cashtags.map((value) => ({ ...value, category: "cashtag" })),
  ]);
  return {
    ...(urls.length ? { urls } : {}),
    ...(mentions.length ? { mentions } : {}),
    ...(hashtags.length ? { hashtags } : {}),
    ...(cashtags.length ? { cashtags } : {}),
  };
}

function normalizeTagEntities(
  inputs: readonly XTagEntityInput[],
  marker: "#" | "$",
  normalizeSpan: TextSpanNormalizer,
): NormalizedXTagEntity[] {
  return inputs.map((value) => {
    return {
      ...normalizeSpan(`${marker}${value.tag}`, value.start, value.end),
      tag: value.tag,
    };
  });
}

function assertTagInputs(
  inputs: readonly XTagEntityInput[],
  marker: "#" | "$",
  label: string,
): void {
  for (const [index, value] of inputs.entries()) {
    assertEntityString(value.tag, MAX_ENTITY_LABEL_LENGTH, `${label} entity ${index + 1}`);
    if (/\s/u.test(value.tag) || value.tag.includes(marker)) {
      throw new Error(`X ${label} entity ${index + 1} is invalid`);
    }
  }
}

function sortAndDedupeEntities<T extends XTextSpan>(
  values: T[],
  stableValue: (value: T) => string,
): void {
  values.sort(
    (left, right) =>
      left.start - right.start ||
      left.end - right.end ||
      stableValue(left).localeCompare(stableValue(right)),
  );
  let writeIndex = 0;
  let previous: T | undefined;
  for (const value of values) {
    if (
      previous &&
      value.start === previous.start &&
      value.end === previous.end &&
      stableValue(value) === stableValue(previous)
    ) {
      continue;
    }
    values[writeIndex] = value;
    writeIndex += 1;
    previous = value;
  }
  values.length = writeIndex;
}

function assertNoEntityOverlap(values: Array<XTextSpan & { readonly category: string }>): void {
  values.sort(
    (left, right) =>
      left.start - right.start ||
      left.end - right.end ||
      left.category.localeCompare(right.category),
  );
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1]!;
    const current = values[index]!;
    if (current.start < previous.end) {
      throw new Error("X structured entities contain overlapping exact-text spans");
    }
  }
}

/** Converts provider scalar offsets to JavaScript UTF-16 offsets without rewriting exact text. */
export function normalizeXTextSpan(
  text: string,
  token: string,
  start: number | undefined,
  end: number | undefined,
): XTextSpan {
  return createTextSpanNormalizer(text, [{ token, start, end }])(token, start, end);
}

interface TextSpanInput {
  readonly token: string;
  readonly start?: number;
  readonly end?: number;
}

type TextSpanNormalizer = (
  token: string,
  start: number | undefined,
  end: number | undefined,
) => XTextSpan;

/** Builds hostile-text indexes once per post and reuses them for every provider entity. */
function createTextSpanNormalizer(
  text: string,
  inputs: readonly TextSpanInput[],
): TextSpanNormalizer {
  const offsetlessCounts = new Map<string, number>();
  for (const { token, start, end } of inputs) {
    if (start === undefined && end === undefined) {
      offsetlessCounts.set(token, (offsetlessCounts.get(token) ?? 0) + 1);
    }
  }
  const offsetlessSpans = findOffsetlessSpans(text, offsetlessCounts);
  const offsetlessIndexes = new Map<string, number>();
  let scalarOffsets: readonly number[] | undefined;

  return (token, start, end) => {
    if (start !== undefined || end !== undefined) {
      if (!nonnegativeInteger(start) || !nonnegativeInteger(end) || end <= start) {
        throw new Error("X entity offsets are invalid");
      }
      if (end - start === token.length && text.startsWith(token, start)) return { start, end };
      scalarOffsets ??= scalarToUtf16Offsets(text);
      if (end < scalarOffsets.length) {
        const utf16Start = scalarOffsets[start]!;
        const utf16End = scalarOffsets[end]!;
        if (utf16End - utf16Start === token.length && text.startsWith(token, utf16Start)) {
          return { start: utf16Start, end: utf16End };
        }
      }
      throw new Error("X entity offsets do not match its exact text");
    }

    const spans = offsetlessSpans.get(token);
    if (!spans) throw new Error("X entity has no unambiguous exact-text span");
    const index = offsetlessIndexes.get(token) ?? 0;
    offsetlessIndexes.set(token, index + 1);
    return spans.length === 1 ? spans[0]! : spans[index]!;
  };
}

/** Resolves all offset-less tokens in one bounded text scan, preserving provider multiplicity. */
function findOffsetlessSpans(
  text: string,
  expectedCounts: ReadonlyMap<string, number>,
): ReadonlyMap<string, readonly XTextSpan[]> {
  if (expectedCounts.size === 0) return new Map();
  const buckets = new Map<string, string[]>();
  const matches = new Map<string, XTextSpan[]>();
  for (const token of expectedCounts.keys()) {
    const initial = token[0];
    if (initial === undefined) throw new Error("X entity has no unambiguous exact-text span");
    const bucket = buckets.get(initial) ?? [];
    bucket.push(token);
    buckets.set(initial, bucket);
    matches.set(token, []);
  }

  let work = 0;
  for (let start = 0; start < text.length; start += 1) {
    work += 1;
    for (const token of buckets.get(text[start]!) ?? []) {
      work += token.length;
      if (work > MAX_OFFSETLESS_MATCH_WORK) {
        throw new Error("X offset-less entity matching exceeds its work limit");
      }
      const found = matches.get(token)!;
      if (text.startsWith(token, start) && hasOffsetlessTokenBoundary(text, token, start)) {
        found.push({ start, end: start + token.length });
        if (found.length > expectedCounts.get(token)!) {
          throw new Error("X entity has no unambiguous exact-text span");
        }
      }
    }
  }

  for (const [token, expectedCount] of expectedCounts) {
    const found = matches.get(token)!;
    if (found.length !== 1 && found.length !== expectedCount) {
      throw new Error("X entity has no unambiguous exact-text span");
    }
  }
  return matches;
}

function hasOffsetlessTokenBoundary(text: string, token: string, start: number): boolean {
  const marker = token[0];
  if (marker !== "#" && marker !== "$" && marker !== "@") return true;
  const end = start + token.length;
  if (end >= text.length) return true;
  const nextCodePoint = text.codePointAt(end);
  if (nextCodePoint === undefined) return true;
  const next = String.fromCodePoint(nextCodePoint);
  return marker === "@" ? !/[A-Za-z0-9_]/u.test(next) : !/[\p{L}\p{M}\p{N}_]/u.test(next);
}

function scalarToUtf16Offsets(text: string): readonly number[] {
  const offsets = [0];
  let utf16Offset = 0;
  for (const scalar of text) {
    utf16Offset += scalar.length;
    offsets.push(utf16Offset);
  }
  return offsets;
}

function assertEntityString(value: string, maximum: number, label: string): void {
  if (!value || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`X ${label} is invalid`);
  }
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
