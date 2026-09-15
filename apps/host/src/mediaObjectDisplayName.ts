import { storeTaskKey } from "@rhizome/store-contract";

import { PUSH_TASKS } from "./api/generated/push-tasks.ts";

const MAX_DISPLAY_NAME_CODE_POINTS = 120;

const SOURCE_DISPLAY_NAME_KEYS = ["title", "name", "raw_description", "description"] as const;
const DISPLAY_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

export interface MediaObjectDisplayNameSource {
  readonly inferred?: unknown;
  readonly type?: unknown;
  readonly source?: unknown;
}

export function mediaObjectDisplayName(object: MediaObjectDisplayNameSource): string {
  if (isRecord(object.inferred)) {
    const entry = object.inferred[storeTaskKey(PUSH_TASKS.object["display-name"].name)];
    if (isRecord(entry) && isRecord(entry.properties)) {
      const inferred = normalizedDisplayName(entry.properties.display_name);
      if (inferred) return inferred;
    }
  }
  const properties = sourceProperties(object.source);
  for (const key of SOURCE_DISPLAY_NAME_KEYS) {
    const displayName = normalizedDisplayName(properties?.[key]);
    if (displayName) return displayName;
  }

  const attribution = attributionDisplayName(properties);
  if (attribution) return attribution;

  const type = humanizedType(object.type);
  return boundedDisplayName(type === "transaction" ? "Transaction" : `Untitled ${type}`);
}

function attributionDisplayName(
  properties: Record<string, unknown> | undefined,
): string | undefined {
  const handle = normalizedDisplayName(properties?.author_handle);
  const publishedAt = properties?.published_at;
  if (!handle || typeof publishedAt !== "string") return undefined;
  const date = new Date(publishedAt);
  if (!Number.isFinite(date.getTime())) return undefined;
  const normalizedHandle = handle.replace(/^@+/u, "");
  if (!normalizedHandle) return undefined;
  return boundedDisplayName(`@${normalizedHandle} - ${DISPLAY_DATE_FORMATTER.format(date)}`);
}

function sourceProperties(source: unknown): Record<string, unknown> | undefined {
  if (!isRecord(source)) return undefined;
  const properties = source.properties;
  return isRecord(properties) ? properties : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedDisplayName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = normalizeWhitespace(value);
  return normalized ? boundedDisplayName(normalized) : undefined;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function boundedDisplayName(value: string): string {
  const codePoints = Array.from(value);
  if (codePoints.length <= MAX_DISPLAY_NAME_CODE_POINTS) return value;
  return `${codePoints
    .slice(0, MAX_DISPLAY_NAME_CODE_POINTS - 1)
    .join("")
    .trimEnd()}…`;
}

function humanizedType(value: unknown): string {
  if (typeof value !== "string") return "media object";
  const normalized = normalizeWhitespace(value.replace(/[._-]+/gu, " "));
  return normalized ? normalized.toLowerCase() : "media object";
}
