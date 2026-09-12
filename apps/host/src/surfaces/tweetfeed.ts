import type { MediaObject } from "@rnet/types";

export function httpLink(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password)
      return url.href;
  } catch {
    // Untrusted source data can contain non-URLs.
  }
}

export function tweetDate(object: MediaObject): Date | undefined {
  const value = object.source.properties.published_at;
  if (typeof value !== "string") return;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export function newestTweets(objects: MediaObject[]) {
  return objects
    .map((object, position) => ({ object, position, date: tweetDate(object) }))
    .sort((a, b) => {
      if (a.date && b.date) return b.date.getTime() - a.date.getTime() || a.position - b.position;
      if (a.date) return -1;
      if (b.date) return 1;
      return a.position - b.position;
    });
}

/** Preserve the exact visible text; only safe destinations become anchors. */
export function tweetTextParts(text: string, entities: unknown): { text: string; href?: string }[] {
  const expanded = new Map<string, string>();
  if (
    entities &&
    typeof entities === "object" &&
    "urls" in entities &&
    Array.isArray(entities.urls)
  ) {
    for (const entity of entities.urls) {
      if (!entity || typeof entity !== "object") continue;
      const href = httpLink(entity.expanded_url);
      if (typeof entity.url === "string" && href) expanded.set(entity.url, href);
    }
  }
  const parts: { text: string; href?: string }[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gu)) {
    let value = match[0].replace(/[.,!?;:]+$/u, "");
    // Keep balanced parentheses in URLs while excluding prose punctuation around them.
    while (value.endsWith(")") && value.split(")").length > value.split("(").length)
      value = value.slice(0, -1);
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index) });
    const href = expanded.get(value) ?? httpLink(value);
    parts.push({ text: value, ...(href ? { href } : {}) });
    cursor = match.index + value.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}
