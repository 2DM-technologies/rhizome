import type {
  NormalizedXEntities,
  NormalizedXMentionEntity,
  NormalizedXTagEntity,
  NormalizedXUrlEntity,
  XTextSpan,
} from "./contracts.ts";

const MAX_ENTITY_URL_LENGTH = 8_192;
const MAX_ENTITY_LABEL_LENGTH = 256;
const MAX_STRUCTURED_ENTITIES = 1_024;
const X_USERNAME = /^[A-Za-z0-9_]{1,15}$/u;

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
  const urls = (input.urls ?? []).map((value, index): NormalizedXUrlEntity => {
    assertEntityString(value.url, MAX_ENTITY_URL_LENGTH, `URL entity ${index + 1}`);
    if (value.expandedUrl !== undefined) {
      assertEntityString(
        value.expandedUrl,
        MAX_ENTITY_URL_LENGTH,
        `expanded URL entity ${index + 1}`,
      );
    }
    const { start, end } = normalizeXTextSpan(text, value.url, value.start, value.end);
    return {
      start,
      end,
      url: value.url,
      ...(value.expandedUrl ? { expanded_url: value.expandedUrl } : {}),
    };
  });
  const mentions = (input.mentions ?? []).map((value, index): NormalizedXMentionEntity => {
    if (!X_USERNAME.test(value.username)) {
      throw new Error(`X mention entity ${index + 1} is invalid`);
    }
    return {
      ...normalizeXTextSpan(text, `@${value.username}`, value.start, value.end),
      username: value.username,
    };
  });
  const hashtags = normalizeTagEntities(text, input.hashtags ?? [], "#", "hashtag");
  const cashtags = normalizeTagEntities(text, input.cashtags ?? [], "$", "cashtag");

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
  text: string,
  inputs: readonly XTagEntityInput[],
  marker: "#" | "$",
  label: string,
): NormalizedXTagEntity[] {
  return inputs.map((value, index) => {
    assertEntityString(value.tag, MAX_ENTITY_LABEL_LENGTH, `${label} entity ${index + 1}`);
    if (/\s/u.test(value.tag) || value.tag.includes(marker)) {
      throw new Error(`X ${label} entity ${index + 1} is invalid`);
    }
    return {
      ...normalizeXTextSpan(text, `${marker}${value.tag}`, value.start, value.end),
      tag: value.tag,
    };
  });
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
  if (start !== undefined || end !== undefined) {
    if (!nonnegativeInteger(start) || !nonnegativeInteger(end) || end <= start) {
      throw new Error("X entity offsets are invalid");
    }
    if (text.slice(start, end) === token) return { start, end };
    const scalars = [...text];
    if (end <= scalars.length) {
      const utf16Start = scalars.slice(0, start).join("").length;
      const utf16End = scalars.slice(0, end).join("").length;
      if (text.slice(utf16Start, utf16End) === token) {
        return { start: utf16Start, end: utf16End };
      }
    }
    throw new Error("X entity offsets do not match its exact text");
  }
  const exactStart = text.indexOf(token);
  if (exactStart < 0 || text.indexOf(token, exactStart + token.length) >= 0) {
    throw new Error("X entity has no unambiguous exact-text span");
  }
  return { start: exactStart, end: exactStart + token.length };
}

function assertEntityString(value: string, maximum: number, label: string): void {
  if (!value || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`X ${label} is invalid`);
  }
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
