const MAX_TIMELINE_POSTS = 100;
const MAX_TIMELINE_MEDIA = 400;
const MAX_POST_ENTITIES = 1_024;
const DECIMAL_ID = /^[0-9]{1,19}$/u;

export type XApiPostReferenceType = "replied_to" | "quoted" | "retweeted";

export interface XApiUrlEntity {
  readonly start?: number;
  readonly end?: number;
  readonly url: string;
  readonly expanded_url?: string;
}

export interface XApiMentionEntity {
  readonly start?: number;
  readonly end?: number;
  readonly username: string;
}

export interface XApiTagEntity {
  readonly start?: number;
  readonly end?: number;
  readonly tag: string;
}

export interface XApiPostEntities {
  readonly urls?: readonly XApiUrlEntity[];
  readonly mentions?: readonly XApiMentionEntity[];
  readonly hashtags?: readonly XApiTagEntity[];
  readonly cashtags?: readonly XApiTagEntity[];
}

export interface XApiPost {
  readonly id: string;
  readonly text: string;
  readonly author_id: string;
  readonly created_at: string;
  readonly conversation_id?: string;
  readonly referenced_tweets?: readonly {
    readonly type: XApiPostReferenceType;
    readonly id: string;
  }[];
  readonly attachments?: { readonly media_keys: readonly string[] };
  readonly lang?: string;
  readonly possibly_sensitive?: boolean;
  readonly edit_history_tweet_ids?: readonly string[];
  readonly entities?: XApiPostEntities;
  /** Full long-form post content returned when the note_tweet field is requested. */
  readonly note_tweet?: {
    readonly text: string;
    readonly entities?: XApiPostEntities;
  };
}

export interface XApiMediaVariant {
  readonly content_type: string;
  readonly url: string;
  readonly bit_rate?: number;
}

export interface XApiMedia {
  readonly media_key: string;
  readonly type: string;
  readonly url?: string;
  readonly alt_text?: string;
  readonly variants?: readonly XApiMediaVariant[];
}

export interface XApiTimelinePage {
  readonly data: readonly XApiPost[];
  readonly includes: { readonly media: readonly XApiMedia[] };
  readonly meta: {
    readonly result_count: number;
    readonly newest_id?: string;
    readonly oldest_id?: string;
    readonly next_token?: string;
  };
}

/** A provider-payload contract error. Callers classify it at their own trust boundary. */
export class XTimelinePayloadError extends Error {
  constructor(
    message: string,
    readonly kind: "invalid_response" | "provider_rejected" = "invalid_response",
  ) {
    super(message);
    this.name = "XTimelinePayloadError";
  }
}

/** Strictly validates and projects a provider timeline into the persisted capture schema. */
export function parseXTimelinePage(value: unknown): XApiTimelinePage {
  if (!record(value)) throw invalid("X timeline response is invalid");
  if (value.error !== undefined) {
    throw providerRejected();
  }
  if (value.errors !== undefined) {
    if (!Array.isArray(value.errors)) throw invalid("X timeline errors are invalid");
    if (value.errors.length > 0) throw providerRejected();
  }

  const data = value.data === undefined ? [] : value.data;
  if (!Array.isArray(data)) throw invalid("X timeline data is invalid");
  if (data.length > MAX_TIMELINE_POSTS) {
    throw invalid("X timeline exceeds the one-page product cap");
  }
  const posts = data.map(parsePost);

  const includes = value.includes === undefined ? {} : value.includes;
  if (!record(includes)) throw invalid("X timeline includes are invalid");
  const rawMedia = includes.media === undefined ? [] : includes.media;
  if (!Array.isArray(rawMedia)) throw invalid("X timeline media includes are invalid");
  if (rawMedia.length > MAX_TIMELINE_MEDIA) {
    throw invalid("X timeline has too many media expansions");
  }
  const media = rawMedia.map(parseMedia);

  const meta = value.meta;
  if (!record(meta) || !nonnegativeInteger(meta.result_count)) {
    throw invalid("X timeline result count is invalid");
  }
  if (meta.result_count !== posts.length) {
    throw invalid("X timeline result count contradicts its records");
  }
  const newestId = optionalDecimal(meta.newest_id, "X timeline newest id");
  const oldestId = optionalDecimal(meta.oldest_id, "X timeline oldest id");
  if (newestId !== undefined && !posts.some(({ id }) => id === newestId)) {
    throw invalid("X timeline newest id contradicts its records");
  }
  if (oldestId !== undefined && !posts.some(({ id }) => id === oldestId)) {
    throw invalid("X timeline oldest id contradicts its records");
  }
  const nextToken = optionalString(meta.next_token, "X timeline pagination token", 1, 1_024);

  return {
    data: posts,
    includes: { media },
    meta: {
      result_count: posts.length,
      ...(newestId ? { newest_id: newestId } : {}),
      ...(oldestId ? { oldest_id: oldestId } : {}),
      ...(nextToken ? { next_token: nextToken } : {}),
    },
  };
}

function parsePost(value: unknown, index: number): XApiPost {
  if (!record(value)) throw invalid(`X timeline post ${index} is invalid`);
  const id = requiredDecimal(value.id, `X timeline post ${index} id`);
  const authorId = requiredDecimal(value.author_id, `X timeline post ${id} author`);
  const text = boundedString(value.text, 1, 1_000_000);
  const createdAt = optionalDateTime(value.created_at);
  if (!text || !createdAt) throw invalid(`X timeline post ${id} is incomplete`);

  let references: XApiPost["referenced_tweets"];
  if (value.referenced_tweets !== undefined) {
    if (!Array.isArray(value.referenced_tweets)) {
      throw invalid(`X timeline post ${id} references are invalid`);
    }
    if (value.referenced_tweets.length > 3) {
      throw invalid(`X timeline post ${id} has too many references`);
    }
    references = value.referenced_tweets.map((reference) => {
      if (
        !record(reference) ||
        !["replied_to", "quoted", "retweeted"].includes(String(reference.type))
      ) {
        throw invalid(`X timeline post ${id} reference is invalid`);
      }
      return {
        type: reference.type as XApiPostReferenceType,
        id: requiredDecimal(reference.id, `X timeline post ${id} reference id`),
      };
    });
  }

  let attachments: XApiPost["attachments"];
  if (value.attachments !== undefined) {
    if (!record(value.attachments) || !Array.isArray(value.attachments.media_keys)) {
      throw invalid(`X timeline post ${id} attachments are invalid`);
    }
    if (value.attachments.media_keys.length > 4) {
      throw invalid(`X timeline post ${id} has too many attachments`);
    }
    attachments = {
      media_keys: value.attachments.media_keys.map((key) => {
        const mediaKey = boundedString(key, 1, 256);
        if (!mediaKey) throw invalid(`X timeline post ${id} media key is invalid`);
        return mediaKey;
      }),
    };
  }

  const editIds = value.edit_history_tweet_ids;
  if (editIds !== undefined && !Array.isArray(editIds)) {
    throw invalid(`X timeline post ${id} edit history is invalid`);
  }
  if (Array.isArray(editIds) && editIds.length > 100) {
    throw invalid(`X timeline post ${id} edit history is too large`);
  }
  const entities = value.entities === undefined ? undefined : parsePostEntities(value.entities, id);
  const noteTweet =
    value.note_tweet === undefined ? undefined : parseNoteTweet(value.note_tweet, id);
  const conversationId = optionalDecimal(
    value.conversation_id,
    `X timeline post ${id} conversation id`,
  );
  const lang = optionalString(value.lang, `X timeline post ${id} language`, 1, 35);
  if (value.possibly_sensitive !== undefined && typeof value.possibly_sensitive !== "boolean") {
    throw invalid(`X timeline post ${id} sensitivity flag is invalid`);
  }
  return {
    id,
    text,
    author_id: authorId,
    created_at: createdAt,
    ...(conversationId ? { conversation_id: conversationId } : {}),
    ...(references ? { referenced_tweets: references } : {}),
    ...(attachments ? { attachments } : {}),
    ...(lang ? { lang } : {}),
    ...(typeof value.possibly_sensitive === "boolean"
      ? { possibly_sensitive: value.possibly_sensitive }
      : {}),
    ...(editIds
      ? {
          edit_history_tweet_ids: editIds.map((editId) =>
            requiredDecimal(editId, `X timeline post ${id} edit id`),
          ),
        }
      : {}),
    ...(entities ? { entities } : {}),
    ...(noteTweet ? { note_tweet: noteTweet } : {}),
  };
}

function parseNoteTweet(value: unknown, postId: string): NonNullable<XApiPost["note_tweet"]> {
  if (!record(value)) throw invalid(`X timeline post ${postId} note tweet is invalid`);
  const text = boundedString(value.text, 1, 1_000_000);
  if (!text) throw invalid(`X timeline post ${postId} note tweet text is invalid`);
  const entities =
    value.entities === undefined
      ? undefined
      : parsePostEntities(value.entities, postId, "note tweet");
  return { text, ...(entities ? { entities } : {}) };
}

function parseMedia(value: unknown, index: number): XApiMedia {
  if (!record(value)) throw invalid(`X timeline media ${index} is invalid`);
  const mediaKey = boundedString(value.media_key, 1, 256);
  const type = boundedString(value.type, 1, 64);
  if (!mediaKey || !type) throw invalid(`X timeline media ${index} is invalid`);
  let variants: XApiMediaVariant[] | undefined;
  if (value.variants !== undefined) {
    if (!Array.isArray(value.variants)) {
      throw invalid(`X timeline media ${mediaKey} variants are invalid`);
    }
    if (value.variants.length > 100) {
      throw invalid(`X timeline media ${mediaKey} has too many variants`);
    }
    variants = value.variants.map((variant) => {
      if (!record(variant)) throw invalid(`X timeline media ${mediaKey} variant is invalid`);
      const contentType = boundedString(variant.content_type, 1, 128);
      const url = boundedString(variant.url, 1, 8_192);
      if (!contentType || !url) throw invalid(`X timeline media ${mediaKey} variant is invalid`);
      const bitRate = optionalNonnegativeInteger(variant.bit_rate, 10_000_000_000);
      if (variant.bit_rate !== undefined && bitRate === undefined) {
        throw invalid(`X timeline media ${mediaKey} variant bit rate is invalid`);
      }
      return {
        content_type: contentType,
        url,
        ...(bitRate !== undefined ? { bit_rate: bitRate } : {}),
      };
    });
  }
  const url = optionalString(value.url, `X timeline media ${mediaKey} URL`, 1, 8_192);
  const alt = optionalString(value.alt_text, `X timeline media ${mediaKey} alt text`, 0, 8_192);
  return {
    media_key: mediaKey,
    type,
    ...(url ? { url } : {}),
    ...(alt !== undefined ? { alt_text: alt } : {}),
    ...(variants ? { variants } : {}),
  };
}

function parsePostEntities(value: unknown, postId: string, context = ""): XApiPostEntities {
  const label = context ? `${context} entities` : "entities";
  if (!record(value)) throw invalid(`X timeline post ${postId} ${label} are invalid`);
  const urls = providerEntityArray(value, "urls", postId, context);
  const mentions = providerEntityArray(value, "mentions", postId, context);
  const hashtags = providerEntityArray(value, "hashtags", postId, context);
  const cashtags = providerEntityArray(value, "cashtags", postId, context);
  if (urls.length + mentions.length + hashtags.length + cashtags.length > MAX_POST_ENTITIES) {
    throw invalid(
      `X timeline post ${postId} ${context ? `${context} ` : ""}has too many structured entities`,
    );
  }
  return {
    ...(urls.length
      ? {
          urls: urls.map((entity, index) => {
            if (!record(entity))
              throw invalid(`X timeline post ${postId} URL entity ${index} is invalid`);
            const url = boundedString(entity.url, 1, 8_192);
            const expandedUrl = optionalString(
              entity.expanded_url,
              `X timeline post ${postId} expanded URL entity`,
              1,
              8_192,
            );
            if (!url) throw invalid(`X timeline post ${postId} URL entity ${index} is invalid`);
            return {
              url,
              ...(expandedUrl ? { expanded_url: expandedUrl } : {}),
              ...providerEntitySpan(entity, postId, "URL", index),
            };
          }),
        }
      : {}),
    ...(mentions.length
      ? {
          mentions: mentions.map((entity, index) => {
            if (!record(entity))
              throw invalid(`X timeline post ${postId} mention ${index} is invalid`);
            const username = boundedString(entity.username, 1, 15);
            if (!username || !/^[A-Za-z0-9_]+$/u.test(username)) {
              throw invalid(`X timeline post ${postId} mention ${index} is invalid`);
            }
            return { username, ...providerEntitySpan(entity, postId, "mention", index) };
          }),
        }
      : {}),
    ...(hashtags.length
      ? {
          hashtags: hashtags.map((entity, index) =>
            parseTagEntity(entity, postId, "hashtag", index),
          ),
        }
      : {}),
    ...(cashtags.length
      ? {
          cashtags: cashtags.map((entity, index) =>
            parseTagEntity(entity, postId, "cashtag", index),
          ),
        }
      : {}),
  };
}

function providerEntityArray(
  entities: Readonly<Record<string, unknown>>,
  key: string,
  postId: string,
  context: string,
): readonly unknown[] {
  const value = entities[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw invalid(
      `X timeline post ${postId} ${context ? `${context} ` : ""}${key} entities are invalid`,
    );
  }
  return value;
}

function providerEntitySpan(
  entity: Readonly<Record<string, unknown>>,
  postId: string,
  label: string,
  index: number,
): { readonly start?: number; readonly end?: number } {
  const start = optionalNonnegativeInteger(entity.start, 1_000_000);
  const end = optionalNonnegativeInteger(entity.end, 1_000_000);
  if (
    (entity.start === undefined) !== (entity.end === undefined) ||
    (entity.start !== undefined && (start === undefined || end === undefined || end <= start))
  ) {
    throw invalid(`X timeline post ${postId} ${label} entity ${index} is invalid`);
  }
  return start !== undefined && end !== undefined ? { start, end } : {};
}

function parseTagEntity(
  entity: unknown,
  postId: string,
  label: "hashtag" | "cashtag",
  index: number,
): XApiTagEntity {
  if (!record(entity))
    throw invalid(`X timeline post ${postId} ${label} entity ${index} is invalid`);
  const tag = boundedString(entity.tag, 1, 256);
  if (!tag || /[\s\u0000-\u001f\u007f]/u.test(tag)) {
    throw invalid(`X timeline post ${postId} ${label} entity ${index} is invalid`);
  }
  return { tag, ...providerEntitySpan(entity, postId, label, index) };
}

function invalid(message: string): XTimelinePayloadError {
  return new XTimelinePayloadError(message);
}

function providerRejected(): XTimelinePayloadError {
  return new XTimelinePayloadError("X timeline contains provider errors", "provider_rejected");
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, minimum: number, maximum: number): string | undefined {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum
    ? value
    : undefined;
}

function requiredDecimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !DECIMAL_ID.test(value)) throw invalid(`${label} is invalid`);
  return value;
}

function optionalDecimal(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredDecimal(value, label);
}

function optionalDateTime(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function optionalNonnegativeInteger(value: unknown, maximum: number): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum
    ? Number(value)
    : undefined;
}

function optionalString(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): string | undefined {
  if (value === undefined) return undefined;
  const parsed = boundedString(value, minimum, maximum);
  if (parsed === undefined) throw invalid(`${label} is invalid`);
  return parsed;
}
