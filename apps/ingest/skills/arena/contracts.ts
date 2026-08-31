export const ARENA_SKILL_ID = "arena" as const;
export const ARENA_PARSER_NAME = "arena" as const;
export const ARENA_CONNECTOR_VERSION = "arena-connector@1.0.0" as const;
export const ARENA_CHANNEL_SLUG_MAX_LENGTH = 128;

export const arenaSourceConfigSchema = {
  type: "object",
  required: ["url"],
  properties: {
    url: {
      type: "string",
      format: "uri",
      pattern: "^https://(?:www\\.)?are\\.na/[^/?#]+/[^/?#]+/?$",
      maxLength: 2_048,
    },
  },
  additionalProperties: false,
} as const;

export interface ArenaSourceConfig {
  readonly url: string;
}

export interface ArenaChannelLocator {
  readonly canonicalUrl: string;
  readonly ownerSlug: string;
  readonly channelSlug: string;
}

const CHANNEL_SLUG = new RegExp(`^[a-z0-9][a-z0-9_-]{0,${ARENA_CHANNEL_SLUG_MAX_LENGTH - 1}}$`);

/**
 * Treats an Are.na page URL as a semantic locator, not as a page to scrape. The connector uses
 * only the normalized slug against its fixed API origin.
 */
export function normalizeArenaChannelLocator(value: unknown): ArenaChannelLocator {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new Error("Are.na channel URL is required");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Are.na channel URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    (url.hostname !== "are.na" && url.hostname !== "www.are.na") ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    throw new Error("Are.na channel URL must identify a public are.na channel");
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const ownerSlug = segments[0] ?? "";
  const channelSlug = segments[1] ?? "";
  if (segments.length !== 2 || !CHANNEL_SLUG.test(ownerSlug) || !CHANNEL_SLUG.test(channelSlug)) {
    throw new Error("Are.na channel URL must be https://www.are.na/owner/channel-slug");
  }
  return {
    canonicalUrl: `https://www.are.na/${ownerSlug}/${channelSlug}`,
    ownerSlug,
    channelSlug,
  };
}

export function parseArenaSourceConfig(value: unknown): ArenaSourceConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Are.na source config must be an object");
  }
  const config = value as Record<string, unknown>;
  if (Object.keys(config).length !== 1 || !("url" in config)) {
    throw new Error("Are.na source config accepts only url");
  }
  return { url: normalizeArenaChannelLocator(config.url).canonicalUrl };
}
