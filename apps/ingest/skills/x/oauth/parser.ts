import type { SourceExecutionLimits } from "../../../../../packages/store-contract/src/source-skills.ts";

import type { SourceParser } from "../../../source-skills/candidate-bundle.ts";
import { openValidatedZip, readZipBytes, readZipText } from "../archive/zip.ts";
import type {
  NormalizedXAttachment,
  NormalizedXEntities,
  NormalizedXPost,
  NormalizedXPostReference,
  SelectedXPosts,
  XAccountIdentity,
  XMediaOmissionReason,
  XSelectionCounts,
} from "../contracts.ts";
import { sha256 } from "../contracts.ts";
import { X_POST_PARSER_NAME, X_POST_PARSER_VERSION, X_SOURCE_LIMITS } from "../definition.ts";
import { isXStatusUrl, normalizeXEntities, normalizeXTextSpan } from "../entities.ts";
import { compareXPostsNewestFirst, selectXPosts } from "../tweet-candidates.ts";

export const X_OAUTH_CAPTURE_FORMAT = "rhizome.x-oauth-capture@1" as const;
export const X_OAUTH_CAPTURE_MIME = "application/vnd.rhizome.x-oauth-capture+zip" as const;
export const X_OAUTH_MANIFEST_PATH = "manifest.json" as const;
export const X_OAUTH_TIMELINE_PATH = "timeline.json" as const;
export const X_OAUTH_EDIT_OVERLAP_MS = 30 * 60 * 1_000;

const MAX_MANIFEST_BYTES = 2 * 1_024 * 1_024;
const MAX_TIMELINE_BYTES = 8 * 1_024 * 1_024;
const MAX_POST_ATTACHMENTS = 4;
const MAX_CAPTURE_MEDIA = 100 * MAX_POST_ATTACHMENTS;
const DECIMAL_ID = /^[0-9]+$/;
const HASH = /^sha256:[a-f0-9]{64}$/;
const SUPPORTED_IMAGE_MIMES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

export interface XApiUserRecord {
  readonly id: string;
  readonly username?: string;
  readonly name?: string;
}

export interface XApiUrlEntityRecord {
  readonly start?: number;
  readonly end?: number;
  readonly url: string;
  readonly expanded_url?: string;
  readonly display_url?: string;
  readonly unwound_url?: string;
}

export interface XApiMentionEntityRecord {
  readonly start?: number;
  readonly end?: number;
  readonly username: string;
}

export interface XApiTagEntityRecord {
  readonly start?: number;
  readonly end?: number;
  readonly tag: string;
}

export interface XApiMediaRecord {
  readonly media_key: string;
  readonly type: string;
  readonly url?: string;
  readonly preview_image_url?: string;
  readonly alt_text?: string;
  readonly variants?: readonly {
    readonly bit_rate?: number;
    readonly content_type?: string;
    readonly url?: string;
  }[];
}

export interface XApiPostRecord {
  readonly id: string;
  readonly text: string;
  readonly author_id: string;
  readonly created_at: string;
  readonly conversation_id?: string;
  readonly referenced_tweets?: readonly {
    readonly type: "replied_to" | "quoted" | "retweeted";
    readonly id: string;
  }[];
  readonly attachments?: { readonly media_keys?: readonly string[] };
  readonly lang?: string;
  readonly possibly_sensitive?: boolean;
  readonly edit_history_tweet_ids?: readonly string[];
  readonly entities?: Readonly<Record<string, unknown>> & {
    readonly urls?: readonly XApiUrlEntityRecord[];
    readonly mentions?: readonly XApiMentionEntityRecord[];
    readonly hashtags?: readonly XApiTagEntityRecord[];
    readonly cashtags?: readonly XApiTagEntityRecord[];
  };
}

export interface XApiTimelinePageRecord {
  readonly data?: readonly XApiPostRecord[];
  readonly includes?: { readonly media?: readonly XApiMediaRecord[] };
  readonly meta?: {
    readonly result_count?: number;
    readonly newest_id?: string;
    readonly oldest_id?: string;
    readonly next_token?: string;
  };
  readonly errors?: readonly unknown[];
}

export interface XOAuthCheckpoint {
  /** Newest provider record seen, including one later excluded by source VERIFY. */
  readonly newestSeenId: string;
  readonly newestSeenPublishedAt: string;
  /** A bounded provider edit window used for the next one-page request. */
  readonly overlapStartTime: string;
}

export interface XOAuthTimelineRequestEvidence {
  readonly maxResults: 100;
  readonly exclude: readonly ["replies", "retweets"];
  readonly startTime?: string;
  readonly previousCheckpoint?: XOAuthCheckpoint;
}

export interface XOAuthIncludedMedia {
  readonly postId: string;
  readonly attachmentIndex: number;
  readonly mediaKey: string;
  readonly sourceUrl: string;
  readonly capturePath: string;
  readonly kind: "image" | "video";
  readonly mime: string;
  readonly alt?: string;
  readonly byteSize: number;
  readonly contentHash: `sha256:${string}`;
}

export interface XOAuthMediaOmission {
  readonly postId: string;
  readonly attachmentIndex: number;
  readonly mediaKey: string;
  readonly sourceUrl?: string;
  readonly reason: XMediaOmissionReason;
  readonly kind?: "image" | "video";
  readonly mime?: string;
  readonly byteSize?: number;
}

export interface XOAuthCaptureManifest {
  readonly format: typeof X_OAUTH_CAPTURE_FORMAT;
  readonly retrievedAt: string;
  readonly account: XAccountIdentity;
  readonly limits: SourceExecutionLimits;
  readonly request: XOAuthTimelineRequestEvidence;
  readonly checkpoint?: XOAuthCheckpoint;
  readonly counts: XSelectionCounts;
  readonly selectedPostIds: readonly string[];
  readonly includedMedia: readonly XOAuthIncludedMedia[];
  readonly mediaOmissions: readonly XOAuthMediaOmission[];
}

export interface XOAuthMediaDescriptor {
  readonly mediaKey: string;
  readonly kind?: "image" | "video";
  readonly mime?: string;
  readonly sourceUrl?: string;
  readonly alt?: string;
  readonly declaredOmission?: "missing_media" | "unsupported_media";
}

export interface NormalizedXOAuthTimeline {
  readonly selection: SelectedXPosts;
  readonly mediaByPostId: ReadonlyMap<string, readonly XOAuthMediaDescriptor[]>;
  readonly checkpoint?: XOAuthCheckpoint;
}

export interface ParsedXOAuthCapture {
  readonly manifest: XOAuthCaptureManifest;
  readonly selection: SelectedXPosts;
}

/**
 * Converts one provider page to the shared X IR. This is also used before remote media fetches so
 * only attachments belonging to the selected, eligible posts are requested.
 */
export function normalizeXOAuthTimeline(input: {
  readonly account: XAccountIdentity;
  readonly timeline: unknown;
  readonly limits: SourceExecutionLimits;
  readonly retrievedAt: string;
  readonly previousCheckpoint?: XOAuthCheckpoint;
}): NormalizedXOAuthTimeline {
  const account = assertAccount(input.account);
  const timeline = parseTimeline(input.timeline);
  assertLimits(input.limits);
  assertDateTime(input.retrievedAt, "retrieval timestamp");
  if (input.previousCheckpoint) assertCheckpoint(input.previousCheckpoint, "previous checkpoint");
  if ((timeline.data?.length ?? 0) > 100) {
    throw new Error("X OAuth timeline exceeds the one-page product cap");
  }
  if ((timeline.includes?.media?.length ?? 0) > MAX_CAPTURE_MEDIA) {
    throw new Error("X OAuth timeline has too many media expansions");
  }

  const mediaByKey = new Map<string, XApiMediaRecord>();
  for (const media of timeline.includes?.media ?? []) {
    const parsed = parseMedia(media);
    if (mediaByKey.has(parsed.media_key)) {
      throw new Error(`X OAuth timeline repeats media key ${parsed.media_key}`);
    }
    mediaByKey.set(parsed.media_key, parsed);
  }

  const mediaByPostId = new Map<string, readonly XOAuthMediaDescriptor[]>();
  const posts = (timeline.data ?? []).map((value, index) => {
    const post = parsePost(value, index);
    const normalized = normalizePost(post, account, mediaByKey);
    mediaByPostId.set(normalized.post.id, normalized.media);
    return normalized.post;
  });
  if (timeline.meta?.result_count !== undefined && timeline.meta.result_count !== posts.length) {
    throw new Error("X OAuth timeline result count contradicts its records");
  }
  if (
    timeline.meta?.newest_id !== undefined &&
    !posts.some(({ id }) => id === timeline.meta!.newest_id)
  ) {
    throw new Error("X OAuth timeline newest id contradicts its records");
  }
  if (
    timeline.meta?.oldest_id !== undefined &&
    !posts.some(({ id }) => id === timeline.meta!.oldest_id)
  ) {
    throw new Error("X OAuth timeline oldest id contradicts its records");
  }

  const selection = selectXPosts({
    account,
    posts,
    cap: input.limits.maxCandidates,
    retrievedAt: input.retrievedAt,
  });
  const newest = [...posts].sort(compareXPostsNewestFirst)[0];
  const currentCheckpoint = newest ? checkpointForPost(newest) : undefined;
  const checkpoint = newestCheckpoint(currentCheckpoint, input.previousCheckpoint);
  return { selection, mediaByPostId, ...(checkpoint ? { checkpoint } : {}) };
}

/** Reads and independently validates the untrusted versioned capture. */
export async function parseXOAuthCapture(
  bytes: Uint8Array,
  effectiveLimits: SourceExecutionLimits,
): Promise<ParsedXOAuthCapture> {
  assertLimits(effectiveLimits);
  if (bytes.byteLength > effectiveLimits.maxCaptureBytes) {
    throw new Error("X OAuth capture exceeds the effective capture limit");
  }
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const capture = await openValidatedZip(new Blob([owned.buffer]), 2 + MAX_CAPTURE_MEDIA);
  try {
    const manifestEntry = capture.byPath.get(X_OAUTH_MANIFEST_PATH);
    const timelineEntry = capture.byPath.get(X_OAUTH_TIMELINE_PATH);
    if (!manifestEntry || !timelineEntry) {
      throw new Error("X OAuth capture is missing required entries");
    }
    const manifest = JSON.parse(await readZipText(manifestEntry, MAX_MANIFEST_BYTES)) as unknown;
    assertCaptureManifest(manifest);
    if (!sameLimits(manifest.limits, effectiveLimits)) {
      throw new Error("X OAuth capture limits do not match the effective source limits");
    }
    const timeline = JSON.parse(await readZipText(timelineEntry, MAX_TIMELINE_BYTES)) as unknown;
    const normalized = normalizeXOAuthTimeline({
      account: manifest.account,
      timeline,
      limits: effectiveLimits,
      retrievedAt: manifest.retrievedAt,
      ...(manifest.request.previousCheckpoint
        ? { previousCheckpoint: manifest.request.previousCheckpoint }
        : {}),
    });
    if (!sameJson(normalized.selection.counts, manifest.counts)) {
      throw new Error("X OAuth capture counts contradict the provider records");
    }
    if (
      !sameJson(
        normalized.selection.posts.map(({ id }) => id),
        manifest.selectedPostIds,
      )
    ) {
      throw new Error("X OAuth capture selected IDs contradict the provider records");
    }
    if (!sameJson(normalized.checkpoint, manifest.checkpoint)) {
      throw new Error("X OAuth capture checkpoint contradicts the provider records");
    }

    const declaredPaths = new Set([
      X_OAUTH_MANIFEST_PATH,
      X_OAUTH_TIMELINE_PATH,
      ...manifest.includedMedia.map(({ capturePath }) => capturePath),
    ]);
    if (declaredPaths.size !== 2 + manifest.includedMedia.length) {
      throw new Error("X OAuth capture repeats a media path");
    }
    for (const entry of capture.entries) {
      if (entry.directory || !declaredPaths.has(entry.filename)) {
        throw new Error(`X OAuth capture has an undeclared entry: ${entry.filename}`);
      }
    }
    if (capture.entries.length !== declaredPaths.size) {
      throw new Error("X OAuth capture entry count contradicts its manifest");
    }

    const included = indexEvidence(manifest.includedMedia, "included");
    const omitted = indexEvidence(manifest.mediaOmissions, "omitted");
    const posts: NormalizedXPost[] = [];
    let totalElementBytes = normalized.selection.posts.reduce(
      (sum, post) => sum + new TextEncoder().encode(post.text).byteLength,
      0,
    );
    if (totalElementBytes > effectiveLimits.maxTotalElementBytes) {
      throw new Error("X OAuth capture text exceeds the aggregate element budget");
    }

    for (const post of normalized.selection.posts) {
      const descriptors = normalized.mediaByPostId.get(post.id) ?? [];
      const attachments: NormalizedXAttachment[] = [];
      for (const [attachmentIndex, descriptor] of descriptors.entries()) {
        const key = mediaEvidenceKey(post.id, attachmentIndex);
        const media = included.get(key);
        const omission = omitted.get(key);
        if (Boolean(media) === Boolean(omission)) {
          throw new Error(`X OAuth media ${key} lacks exactly one disposition`);
        }
        if (media) {
          assertIncludedMatchesDescriptor(media, descriptor);
          if (descriptor.declaredOmission) {
            throw new Error(`X OAuth media ${key} includes an unavailable provider attachment`);
          }
          if (media.byteSize > effectiveLimits.maxElementBytes) {
            throw new Error(`X OAuth media ${key} exceeds the element limit`);
          }
          if (totalElementBytes + media.byteSize > effectiveLimits.maxTotalElementBytes) {
            throw new Error(`X OAuth media ${key} exceeds the aggregate element budget`);
          }
          const entry = capture.byPath.get(media.capturePath);
          if (!entry) throw new Error(`X OAuth media payload is missing: ${media.capturePath}`);
          if (entry.uncompressedSize !== media.byteSize) {
            throw new Error(`X OAuth media size contradicts its ZIP entry: ${media.capturePath}`);
          }
          const payload = await readZipBytes(entry, effectiveLimits.maxElementBytes);
          if (
            payload.byteLength !== media.byteSize ||
            (await sha256(payload)) !== media.contentHash
          ) {
            throw new Error(`X OAuth media integrity failed: ${media.capturePath}`);
          }
          attachments.push({
            status: "available",
            kind: media.kind,
            mime: media.mime,
            sourceRef: media.mediaKey,
            ...(media.alt?.trim() ? { alt: media.alt } : {}),
            bytes: payload,
          });
          totalElementBytes += media.byteSize;
        } else {
          assertOmissionMatchesDescriptor(omission!, descriptor);
          attachments.push({
            status: "omitted",
            reason: omission!.reason,
            sourceRef: omission!.mediaKey,
            ...(omission!.kind ? { kind: omission!.kind } : {}),
            ...(omission!.mime ? { mime: omission!.mime } : {}),
            ...(omission!.byteSize !== undefined ? { byteSize: omission!.byteSize } : {}),
          });
        }
      }
      posts.push({ ...post, attachments });
    }
    if (
      included.size + omitted.size !==
      posts.reduce((sum, post) => sum + post.attachments.length, 0)
    ) {
      throw new Error("X OAuth media evidence contains orphan records");
    }
    return { manifest, selection: { ...normalized.selection, posts } };
  } finally {
    await capture.close();
  }
}

export const xOAuthParser: SourceParser<SelectedXPosts> = {
  name: X_POST_PARSER_NAME,
  version: X_POST_PARSER_VERSION,
  async parse(bytes) {
    return (await parseXOAuthCapture(bytes, X_SOURCE_LIMITS)).selection;
  },
};

/** Plans a bounded edit overlap. start_time preserves the overlap; since_id would override it. */
export async function planXOAuthTimelineRequest(
  previousCapture?: Uint8Array,
  effectiveLimits: SourceExecutionLimits = X_SOURCE_LIMITS,
): Promise<Pick<XOAuthTimelineRequestEvidence, "startTime" | "previousCheckpoint">> {
  if (!previousCapture) return {};
  const { manifest } = await parseXOAuthCapture(previousCapture, effectiveLimits);
  return manifest.checkpoint
    ? { startTime: manifest.checkpoint.overlapStartTime, previousCheckpoint: manifest.checkpoint }
    : {};
}

function normalizePost(
  post: XApiPostRecord,
  account: XAccountIdentity,
  mediaByKey: ReadonlyMap<string, XApiMediaRecord>,
): { post: NormalizedXPost; media: readonly XOAuthMediaDescriptor[] } {
  const entities = normalizeXEntities(post.text, {
    urls: (post.entities?.urls ?? []).map((entity) => ({
      url: entity.url,
      ...(entity.expanded_url !== undefined ? { expandedUrl: entity.expanded_url } : {}),
      ...(entity.start !== undefined ? { start: entity.start } : {}),
      ...(entity.end !== undefined ? { end: entity.end } : {}),
    })),
    mentions: (post.entities?.mentions ?? []).map((entity) => ({ ...entity })),
    hashtags: (post.entities?.hashtags ?? []).map((entity) => ({ ...entity })),
    cashtags: (post.entities?.cashtags ?? []).map((entity) => ({ ...entity })),
  });
  const references = normalizeReferences(post, entities);
  const mediaKeys = post.attachments?.media_keys ?? [];
  if (new Set(mediaKeys).size !== mediaKeys.length) {
    throw new Error(`X OAuth post ${post.id} repeats a media key`);
  }
  const media = mediaKeys.map((mediaKey) => mediaDescriptor(mediaKey, mediaByKey.get(mediaKey)));
  return {
    post: {
      id: post.id,
      authorId: post.author_id,
      canonicalUrl: `https://x.com/${account.handle ?? "i/web"}/status/${post.id}`,
      publishedAt: new Date(post.created_at).toISOString(),
      text: post.text,
      ...(account.handle ? { authorHandle: account.handle } : {}),
      ...(account.name !== undefined ? { authorName: account.name } : {}),
      ...(post.conversation_id ? { conversationId: post.conversation_id } : {}),
      references,
      ...(post.lang ? { language: post.lang } : {}),
      ...(post.possibly_sensitive !== undefined
        ? { possiblySensitive: post.possibly_sensitive }
        : {}),
      ...(post.edit_history_tweet_ids ? { editHistoryIds: [...post.edit_history_tweet_ids] } : {}),
      ...(entities ? { entities } : {}),
      attachments: media.map((descriptor): NormalizedXAttachment =>
        descriptor.declaredOmission
          ? {
              status: "omitted",
              reason: descriptor.declaredOmission,
              sourceRef: descriptor.mediaKey,
              ...(descriptor.kind ? { kind: descriptor.kind } : {}),
              ...(descriptor.mime ? { mime: descriptor.mime } : {}),
              ...(descriptor.alt ? { alt: descriptor.alt } : {}),
            }
          : {
              status: "available",
              kind: descriptor.kind!,
              mime: descriptor.mime!,
              sourceRef: descriptor.mediaKey,
              ...(descriptor.alt ? { alt: descriptor.alt } : {}),
              bytes: new Uint8Array(),
            },
      ),
    },
    media,
  };
}

function normalizeReferences(
  post: XApiPostRecord,
  entities: NormalizedXEntities | undefined,
): NormalizedXPostReference[] {
  const references: NormalizedXPostReference[] = [];
  for (const reference of post.referenced_tweets ?? []) {
    if (reference.type === "replied_to") {
      references.push({ kind: "replied_to", postId: reference.id });
    } else if (reference.type === "retweeted") {
      references.push({ kind: "reposted", postId: reference.id });
    } else {
      const quoteEntity = findQuoteEntity(entities, reference.id);
      if (!quoteEntity) {
        throw new Error(`X OAuth quoted post ${post.id} lacks its provider URL entity`);
      }
      references.push({
        kind: "quoted",
        postId: reference.id,
        ...(quoteEntity.expandedUrl ? { url: quoteEntity.expandedUrl } : {}),
        textUrl: quoteEntity.textUrl,
        textSpan: quoteEntity.textSpan,
      });
    }
  }
  return references;
}

function findQuoteEntity(entities: NormalizedXEntities | undefined, quoteId: string) {
  const matches = (entities?.urls ?? []).filter(
    (entity) => entity.expanded_url !== undefined && isXStatusUrl(entity.expanded_url, quoteId),
  );
  if (matches.length !== 1) return undefined;
  const entity = matches[0]!;
  return {
    textUrl: entity.url,
    expandedUrl: entity.expanded_url,
    textSpan: { start: entity.start, end: entity.end },
  };
}

/** Backward-compatible test seam for the shared provider-offset normalizer. */
export const providerTextSpan = normalizeXTextSpan;

function mediaDescriptor(
  mediaKey: string,
  media: XApiMediaRecord | undefined,
): XOAuthMediaDescriptor {
  if (!media) return { mediaKey, declaredOmission: "missing_media" };
  const alt = media.alt_text?.trim() ? media.alt_text : undefined;
  if (media.type === "photo") {
    if (!media.url || !directHttps(media.url)) {
      return {
        mediaKey,
        kind: "image",
        ...(alt ? { alt } : {}),
        declaredOmission: "missing_media",
      };
    }
    return { mediaKey, kind: "image", sourceUrl: media.url, ...(alt ? { alt } : {}) };
  }
  if (media.type === "video" || media.type === "animated_gif") {
    const variants = (media.variants ?? [])
      .filter(
        (variant): variant is { bit_rate?: number; content_type: string; url: string } =>
          variant.content_type === "video/mp4" &&
          typeof variant.url === "string" &&
          directHttps(variant.url) &&
          (variant.bit_rate === undefined || nonnegativeInteger(variant.bit_rate)),
      )
      .sort(
        (left, right) =>
          (right.bit_rate ?? -1) - (left.bit_rate ?? -1) || left.url.localeCompare(right.url),
      );
    const selected = variants[0];
    if (!selected) {
      return {
        mediaKey,
        kind: "video",
        mime: "video/mp4",
        ...(alt ? { alt } : {}),
        declaredOmission: "missing_media",
      };
    }
    return {
      mediaKey,
      kind: "video",
      mime: "video/mp4",
      sourceUrl: selected.url,
      ...(alt ? { alt } : {}),
    };
  }
  return { mediaKey, ...(alt ? { alt } : {}), declaredOmission: "unsupported_media" };
}

function checkpointForPost(post: NormalizedXPost): XOAuthCheckpoint {
  return {
    newestSeenId: post.id,
    newestSeenPublishedAt: post.publishedAt,
    overlapStartTime: new Date(
      Date.parse(post.publishedAt) - X_OAUTH_EDIT_OVERLAP_MS,
    ).toISOString(),
  };
}

function newestCheckpoint(
  current: XOAuthCheckpoint | undefined,
  previous: XOAuthCheckpoint | undefined,
): XOAuthCheckpoint | undefined {
  if (!current) return previous;
  if (!previous) return current;
  const time =
    Date.parse(current.newestSeenPublishedAt) - Date.parse(previous.newestSeenPublishedAt);
  if (time > 0) return current;
  if (time < 0) return previous;
  if (current.newestSeenId.length !== previous.newestSeenId.length) {
    return current.newestSeenId.length > previous.newestSeenId.length ? current : previous;
  }
  return current.newestSeenId.localeCompare(previous.newestSeenId) > 0 ? current : previous;
}

function parseTimeline(value: unknown): XApiTimelinePageRecord {
  if (!record(value)) throw new Error("X OAuth timeline response is invalid");
  if (value.errors !== undefined) {
    if (!Array.isArray(value.errors) || value.errors.length > 0) {
      throw new Error("X OAuth timeline contains provider errors");
    }
  }
  if (value.data !== undefined && !Array.isArray(value.data)) {
    throw new Error("X OAuth timeline data is invalid");
  }
  if (value.includes !== undefined && !record(value.includes)) {
    throw new Error("X OAuth timeline includes are invalid");
  }
  if (
    record(value.includes) &&
    value.includes.media !== undefined &&
    !Array.isArray(value.includes.media)
  ) {
    throw new Error("X OAuth timeline media includes are invalid");
  }
  if (value.meta !== undefined && !record(value.meta)) {
    throw new Error("X OAuth timeline metadata is invalid");
  }
  if (record(value.meta)) {
    if (value.meta.result_count !== undefined && !nonnegativeInteger(value.meta.result_count)) {
      throw new Error("X OAuth timeline result count is invalid");
    }
    for (const key of ["newest_id", "oldest_id"] as const) {
      if (value.meta[key] !== undefined && !decimal(value.meta[key])) {
        throw new Error(`X OAuth timeline ${key} is invalid`);
      }
    }
    if (
      value.meta.next_token !== undefined &&
      (typeof value.meta.next_token !== "string" || !value.meta.next_token)
    ) {
      throw new Error("X OAuth timeline pagination token is invalid");
    }
  }
  return value as unknown as XApiTimelinePageRecord;
}

function parsePost(value: unknown, index: number): XApiPostRecord {
  if (!record(value) || !decimal(value.id) || !decimal(value.author_id)) {
    throw new Error(`X OAuth post ${index} identity is invalid`);
  }
  if (typeof value.text !== "string" || value.text.length === 0 || value.text.length > 1_000_000) {
    throw new Error(`X OAuth post ${value.id} text is invalid`);
  }
  if (typeof value.created_at !== "string") {
    throw new Error(`X OAuth post ${value.id} publication timestamp is invalid`);
  }
  assertDateTime(value.created_at, `post ${value.id} publication timestamp`);
  if (value.conversation_id !== undefined && !decimal(value.conversation_id)) {
    throw new Error(`X OAuth post ${value.id} conversation id is invalid`);
  }
  if (
    value.lang !== undefined &&
    (typeof value.lang !== "string" || !value.lang || value.lang.length > 35)
  ) {
    throw new Error(`X OAuth post ${value.id} language is invalid`);
  }
  if (value.possibly_sensitive !== undefined && typeof value.possibly_sensitive !== "boolean") {
    throw new Error(`X OAuth post ${value.id} sensitivity flag is invalid`);
  }
  if (value.referenced_tweets !== undefined) {
    if (!Array.isArray(value.referenced_tweets)) {
      throw new Error(`X OAuth post ${value.id} references are invalid`);
    }
    for (const reference of value.referenced_tweets) {
      if (
        !record(reference) ||
        !["replied_to", "quoted", "retweeted"].includes(String(reference.type)) ||
        !decimal(reference.id)
      ) {
        throw new Error(`X OAuth post ${value.id} reference is invalid`);
      }
    }
  }
  if (value.attachments !== undefined) {
    if (
      !record(value.attachments) ||
      (value.attachments.media_keys !== undefined && !Array.isArray(value.attachments.media_keys))
    ) {
      throw new Error(`X OAuth post ${value.id} attachments are invalid`);
    }
    for (const mediaKey of (value.attachments.media_keys as unknown[] | undefined) ?? []) {
      if (typeof mediaKey !== "string" || !mediaKey) {
        throw new Error(`X OAuth post ${value.id} media key is invalid`);
      }
    }
    if (
      ((value.attachments.media_keys as unknown[] | undefined) ?? []).length > MAX_POST_ATTACHMENTS
    ) {
      throw new Error(`X OAuth post ${value.id} has too many media attachments`);
    }
  }
  if (value.edit_history_tweet_ids !== undefined) {
    if (
      !Array.isArray(value.edit_history_tweet_ids) ||
      value.edit_history_tweet_ids.some((id) => !decimal(id))
    ) {
      throw new Error(`X OAuth post ${value.id} edit history is invalid`);
    }
  }
  if (value.entities !== undefined && !record(value.entities)) {
    throw new Error(`X OAuth post ${value.id} entities are invalid`);
  }
  if (record(value.entities)) {
    const entityKeys = ["urls", "mentions", "hashtags", "cashtags"] as const;
    let entityCount = 0;
    for (const key of entityKeys) {
      const entities = value.entities[key];
      if (entities === undefined) continue;
      if (!Array.isArray(entities)) {
        throw new Error(`X OAuth post ${value.id} ${key} entities are invalid`);
      }
      entityCount += entities.length;
      for (const entity of entities) {
        if (key === "urls") parseUrlEntity(entity, value.id);
        else if (key === "mentions") parseMentionEntity(entity, value.id);
        else parseTagEntity(entity, value.id, key === "hashtags" ? "hashtag" : "cashtag");
      }
    }
    if (entityCount > 1_024) {
      throw new Error(`X OAuth post ${value.id} has too many structured entities`);
    }
  }
  return value as unknown as XApiPostRecord;
}

function parseUrlEntity(value: unknown, postId: string): XApiUrlEntityRecord {
  if (!record(value) || typeof value.url !== "string" || !value.url) {
    throw new Error(`X OAuth post ${postId} URL entity is invalid`);
  }
  if (
    (value.start === undefined) !== (value.end === undefined) ||
    (value.start !== undefined &&
      (!nonnegativeInteger(value.start) || !nonnegativeInteger(value.end)))
  ) {
    throw new Error(`X OAuth post ${postId} URL entity offsets are invalid`);
  }
  for (const key of ["expanded_url", "display_url", "unwound_url"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "string") {
      throw new Error(`X OAuth post ${postId} URL entity ${key} is invalid`);
    }
  }
  return value as unknown as XApiUrlEntityRecord;
}

function parseMentionEntity(value: unknown, postId: string): XApiMentionEntityRecord {
  if (
    !record(value) ||
    typeof value.username !== "string" ||
    !/^[A-Za-z0-9_]{1,15}$/u.test(value.username)
  ) {
    throw new Error(`X OAuth post ${postId} mention entity is invalid`);
  }
  assertEntityOffsets(value, postId, "mention");
  return value as unknown as XApiMentionEntityRecord;
}

function parseTagEntity(
  value: unknown,
  postId: string,
  label: "hashtag" | "cashtag",
): XApiTagEntityRecord {
  if (
    !record(value) ||
    typeof value.tag !== "string" ||
    !value.tag ||
    value.tag.length > 256 ||
    /[\s\u0000-\u001f\u007f]/u.test(value.tag)
  ) {
    throw new Error(`X OAuth post ${postId} ${label} entity is invalid`);
  }
  assertEntityOffsets(value, postId, label);
  return value as unknown as XApiTagEntityRecord;
}

function assertEntityOffsets(
  value: Readonly<Record<string, unknown>>,
  postId: string,
  label: string,
): void {
  if (
    (value.start === undefined) !== (value.end === undefined) ||
    (value.start !== undefined &&
      (!nonnegativeInteger(value.start) ||
        !nonnegativeInteger(value.end) ||
        Number(value.end) <= Number(value.start)))
  ) {
    throw new Error(`X OAuth post ${postId} ${label} entity offsets are invalid`);
  }
}

function parseMedia(value: unknown): XApiMediaRecord {
  if (
    !record(value) ||
    typeof value.media_key !== "string" ||
    !value.media_key ||
    typeof value.type !== "string" ||
    !value.type
  ) {
    throw new Error("X OAuth media expansion is invalid");
  }
  for (const key of ["url", "preview_image_url", "alt_text"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "string") {
      throw new Error(`X OAuth media ${value.media_key} ${key} is invalid`);
    }
  }
  if (value.variants !== undefined) {
    if (!Array.isArray(value.variants))
      throw new Error(`X OAuth media ${value.media_key} variants are invalid`);
    for (const variant of value.variants) {
      if (
        !record(variant) ||
        (variant.bit_rate !== undefined && !nonnegativeInteger(variant.bit_rate)) ||
        (variant.content_type !== undefined && typeof variant.content_type !== "string") ||
        (variant.url !== undefined && typeof variant.url !== "string")
      ) {
        throw new Error(`X OAuth media ${value.media_key} variant is invalid`);
      }
    }
  }
  return value as unknown as XApiMediaRecord;
}

function assertCaptureManifest(value: unknown): asserts value is XOAuthCaptureManifest {
  if (!record(value) || value.format !== X_OAUTH_CAPTURE_FORMAT) {
    throw new Error("X OAuth capture manifest is invalid");
  }
  assertDateTime(value.retrievedAt, "capture retrieval timestamp");
  assertAccount(value.account);
  assertLimits(value.limits);
  if (
    !record(value.request) ||
    value.request.maxResults !== 100 ||
    !sameJson(value.request.exclude, ["replies", "retweets"])
  ) {
    throw new Error("X OAuth capture request evidence is invalid");
  }
  if (value.request.startTime !== undefined)
    assertDateTime(value.request.startTime, "request start time");
  if (value.request.previousCheckpoint !== undefined) {
    assertCheckpoint(value.request.previousCheckpoint, "request previous checkpoint");
    if (value.request.startTime !== value.request.previousCheckpoint.overlapStartTime) {
      throw new Error("X OAuth capture request does not use its declared edit overlap");
    }
  } else if (value.request.startTime !== undefined) {
    throw new Error("X OAuth capture has a start time without a previous checkpoint");
  }
  if (value.checkpoint !== undefined) assertCheckpoint(value.checkpoint, "capture checkpoint");
  assertCounts(value.counts, value.limits.maxCandidates);
  if (
    !Array.isArray(value.selectedPostIds) ||
    value.selectedPostIds.some((id) => !decimal(id)) ||
    new Set(value.selectedPostIds).size !== value.selectedPostIds.length ||
    value.selectedPostIds.length !== value.counts.importedCount
  ) {
    throw new Error("X OAuth capture selected post IDs are invalid");
  }
  if (!Array.isArray(value.includedMedia) || !Array.isArray(value.mediaOmissions)) {
    throw new Error("X OAuth capture media evidence is invalid");
  }
  if (value.includedMedia.length + value.mediaOmissions.length > MAX_CAPTURE_MEDIA) {
    throw new Error("X OAuth capture has too much media evidence");
  }
  for (const media of value.includedMedia) assertIncludedMedia(media);
  for (const omission of value.mediaOmissions) assertMediaOmission(omission);
}

function assertIncludedMedia(value: unknown): asserts value is XOAuthIncludedMedia {
  if (
    !record(value) ||
    !decimal(value.postId) ||
    !nonnegativeInteger(value.attachmentIndex) ||
    typeof value.mediaKey !== "string" ||
    !value.mediaKey ||
    !safeCapturePath(value.capturePath) ||
    !directHttps(value.sourceUrl) ||
    !["image", "video"].includes(String(value.kind)) ||
    typeof value.mime !== "string" ||
    !value.mime ||
    (value.alt !== undefined && typeof value.alt !== "string") ||
    !positiveInteger(value.byteSize) ||
    typeof value.contentHash !== "string" ||
    !HASH.test(value.contentHash)
  ) {
    throw new Error("X OAuth included-media evidence is invalid");
  }
  if (
    value.kind === "image" ? !SUPPORTED_IMAGE_MIMES.has(value.mime) : value.mime !== "video/mp4"
  ) {
    throw new Error("X OAuth included-media MIME is unsupported");
  }
}

function assertMediaOmission(value: unknown): asserts value is XOAuthMediaOmission {
  if (
    !record(value) ||
    !decimal(value.postId) ||
    !nonnegativeInteger(value.attachmentIndex) ||
    typeof value.mediaKey !== "string" ||
    !value.mediaKey ||
    (value.sourceUrl !== undefined && !directHttps(value.sourceUrl)) ||
    !["missing_media", "unsupported_media", "element_too_large", "total_element_budget"].includes(
      String(value.reason),
    ) ||
    (value.kind !== undefined && !["image", "video"].includes(String(value.kind))) ||
    (value.mime !== undefined && (typeof value.mime !== "string" || !value.mime)) ||
    (value.byteSize !== undefined && !nonnegativeInteger(value.byteSize))
  ) {
    throw new Error("X OAuth media-omission evidence is invalid");
  }
}

function assertIncludedMatchesDescriptor(
  media: XOAuthIncludedMedia,
  descriptor: XOAuthMediaDescriptor,
): void {
  if (
    media.mediaKey !== descriptor.mediaKey ||
    media.sourceUrl !== descriptor.sourceUrl ||
    media.kind !== descriptor.kind ||
    media.alt !== descriptor.alt ||
    (descriptor.mime !== undefined && media.mime !== descriptor.mime)
  ) {
    throw new Error(`X OAuth included media ${media.mediaKey} contradicts the provider record`);
  }
}

function assertOmissionMatchesDescriptor(
  omission: XOAuthMediaOmission,
  descriptor: XOAuthMediaDescriptor,
): void {
  if (
    omission.mediaKey !== descriptor.mediaKey ||
    omission.sourceUrl !== descriptor.sourceUrl ||
    (descriptor.kind !== undefined && omission.kind !== descriptor.kind) ||
    (descriptor.mime !== undefined && omission.mime !== descriptor.mime) ||
    (descriptor.declaredOmission !== undefined && omission.reason !== descriptor.declaredOmission)
  ) {
    throw new Error(`X OAuth omitted media ${omission.mediaKey} contradicts the provider record`);
  }
}

function indexEvidence<T extends XOAuthIncludedMedia | XOAuthMediaOmission>(
  values: readonly T[],
  label: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = mediaEvidenceKey(value.postId, value.attachmentIndex);
    if (result.has(key)) throw new Error(`X OAuth capture repeats ${label} media evidence: ${key}`);
    result.set(key, value);
  }
  return result;
}

function mediaEvidenceKey(postId: string, attachmentIndex: number): string {
  return `${postId}:${attachmentIndex}`;
}

function assertAccount(value: unknown): XAccountIdentity {
  if (
    !record(value) ||
    !decimal(value.id) ||
    (value.handle !== undefined &&
      (typeof value.handle !== "string" || !value.handle || value.handle.length > 64)) ||
    (value.name !== undefined && (typeof value.name !== "string" || value.name.length > 256))
  ) {
    throw new Error("X OAuth account identity is invalid");
  }
  return {
    id: value.id,
    ...(value.handle ? { handle: value.handle } : {}),
    ...(value.name !== undefined ? { name: value.name } : {}),
  };
}

function assertLimits(value: unknown): asserts value is SourceExecutionLimits {
  if (
    !record(value) ||
    !sameJson(Object.keys(value).sort(), [
      "maxCandidates",
      "maxCaptureBytes",
      "maxElementBytes",
      "maxTotalElementBytes",
    ]) ||
    !positiveInteger(value.maxCandidates) ||
    value.maxCandidates > 100 ||
    !positiveInteger(value.maxCaptureBytes) ||
    !positiveInteger(value.maxElementBytes) ||
    !positiveInteger(value.maxTotalElementBytes)
  ) {
    throw new Error("X OAuth capture limits are invalid");
  }
}

function sameLimits(left: SourceExecutionLimits, right: SourceExecutionLimits): boolean {
  return (
    left.maxCandidates === right.maxCandidates &&
    left.maxCaptureBytes === right.maxCaptureBytes &&
    left.maxElementBytes === right.maxElementBytes &&
    left.maxTotalElementBytes === right.maxTotalElementBytes
  );
}

function assertCounts(value: unknown, cap: number): asserts value is XSelectionCounts {
  if (!record(value)) throw new Error("X OAuth capture counts are invalid");
  const keys = [
    "sourceRecordCount",
    "repliesExcluded",
    "repostsExcluded",
    "quotesWithoutCommentaryExcluded",
    "authorMismatchesExcluded",
    "eligibleCount",
    "importedCount",
    "cap",
  ] as const;
  if (keys.some((key) => !nonnegativeInteger(value[key])) || value.cap !== cap) {
    throw new Error("X OAuth capture counts are invalid");
  }
}

function assertCheckpoint(value: unknown, label: string): asserts value is XOAuthCheckpoint {
  if (!record(value) || !decimal(value.newestSeenId))
    throw new Error(`X OAuth ${label} is invalid`);
  assertDateTime(value.newestSeenPublishedAt, `${label} publication timestamp`);
  assertDateTime(value.overlapStartTime, `${label} overlap start time`);
  const expected = new Date(
    Date.parse(value.newestSeenPublishedAt) - X_OAUTH_EDIT_OVERLAP_MS,
  ).toISOString();
  if (value.overlapStartTime !== expected) throw new Error(`X OAuth ${label} overlap is invalid`);
}

function assertDateTime(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error(`X OAuth ${label} is invalid`);
  }
}

function directHttps(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443")
    );
  } catch {
    return false;
  }
}

function safeCapturePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("media/") &&
    value.length <= 1_024 &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    !value.split("/").includes("..")
  );
}

function decimal(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_ID.test(value);
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
