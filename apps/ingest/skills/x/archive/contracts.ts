import type {
  NormalizedXAttachment,
  NormalizedXEntities,
  NormalizedXPost,
  NormalizedXPostReference,
  NormalizedXUrlEntity,
  XAccountIdentity,
  XDeclaredMediaOmissionReason,
  XMediaOmissionReason,
  XSelectionCounts,
} from "../contracts.ts";
import { isXStatusUrl, normalizeXEntities, type XEntitiesInput } from "../entities.ts";

export const X_ARCHIVE_CAPTURE_FORMAT = "rhizome.x-archive-selection@1" as const;
export const X_ARCHIVE_CAPTURE_MIME = "application/vnd.rhizome.x-archive-selection+zip" as const;
export const X_ARCHIVE_POSTS_PATH = "posts.json" as const;
export const X_ARCHIVE_MANIFEST_PATH = "manifest.json" as const;
export const X_ARCHIVE_MAX_POST_ATTACHMENTS = 4;

export interface XArchiveLayout {
  readonly tweetGlobal: "tweet" | "tweets";
  readonly mediaDirectory: "data/tweet_media" | "data/tweets_media";
}

export interface XArchiveIncludedMedia {
  readonly postId: string;
  readonly attachmentIndex: number;
  readonly sourcePath: string;
  readonly capturePath: string;
  readonly kind: "image" | "video";
  readonly mime: string;
  readonly alt?: string;
  readonly byteSize: number;
  readonly contentHash: `sha256:${string}`;
}

export interface XArchiveMediaOmission {
  readonly postId: string;
  readonly attachmentIndex: number;
  readonly sourcePath: string;
  readonly reason: XMediaOmissionReason;
  readonly kind?: "image" | "video";
  readonly mime?: string;
  readonly byteSize?: number;
}

export interface XArchiveSelectionManifest {
  readonly format: typeof X_ARCHIVE_CAPTURE_FORMAT;
  readonly archiveGeneratedAt?: string;
  readonly selectedAt: string;
  readonly account: XAccountIdentity;
  readonly archiveLayout: XArchiveLayout;
  readonly counts: XSelectionCounts;
  readonly includedMedia: readonly XArchiveIncludedMedia[];
  readonly mediaOmissions: readonly XArchiveMediaOmission[];
}

export interface RawXArchiveTweetEnvelope {
  readonly tweet: Readonly<Record<string, unknown>>;
  /** Current downloadable archives store long-form text separately from the tweet row. */
  readonly noteTweet?: Readonly<Record<string, unknown>>;
}

export interface XArchiveSourceManifest {
  readonly archiveGeneratedAt?: string;
  readonly accountId?: string;
  readonly tweetFiles: readonly {
    readonly path: string;
    readonly globalName: string;
  }[];
  readonly noteTweetFiles: readonly {
    readonly path: string;
    readonly globalName: string;
  }[];
}

export interface XArchiveMediaDescriptor {
  readonly sourcePath: string;
  readonly kind?: "image" | "video";
  readonly mime?: string;
  readonly alt?: string;
  readonly declaredOmission?: XDeclaredMediaOmissionReason;
}

export interface NormalizedRawArchivePost {
  readonly post: NormalizedXPost;
  readonly media: readonly XArchiveMediaDescriptor[];
}

const DECIMAL_ID = /^[0-9]+$/;
const CANONICAL_DECIMAL_INTEGER = /^(?:0|[1-9][0-9]*)$/;
const HASH = /^sha256:[a-f0-9]{64}$/;

/** Parses only the expected assignment followed by JSON. Archive JavaScript is never evaluated. */
export function parseArchiveAssignment(value: string, target: "account" | "tweets"): unknown {
  const prefix = `window.YTD.${target}.part0 = `;
  if (!value.startsWith(prefix))
    throw new Error(`X archive ${target} assignment prefix is invalid`);
  let json = value.slice(prefix.length).trim();
  if (json.endsWith(";")) json = json.slice(0, -1).trimEnd();
  if (!json || (!json.startsWith("[") && !json.startsWith("{"))) {
    throw new Error(`X archive ${target} assignment has no JSON payload`);
  }
  try {
    return JSON.parse(json);
  } catch {
    throw new Error(`X archive ${target} assignment contains malformed JSON`);
  }
}

export function parseArchiveDataAssignment(value: string, globalName: string): unknown {
  if (!/^YTD\.(?:tweet|tweets)\.part[0-9]+$/.test(globalName)) {
    throw new Error("X archive tweet global name is invalid");
  }
  return parseAssignment(value, `window.${globalName} = `, "tweet data");
}

export function parseArchiveNoteTweetDataAssignment(value: string, globalName: string): unknown {
  if (!/^YTD\.note_tweet\.part[0-9]+$/.test(globalName)) {
    throw new Error("X archive Note Tweet global name is invalid");
  }
  return parseAssignment(value, `window.${globalName} = `, "Note Tweet data");
}

export function parseRawArchiveManifest(value: string): XArchiveSourceManifest {
  const parsed = parseAssignment(value, "window.__THAR_CONFIG = ", "manifest");
  if (!record(parsed)) throw new Error("X archive manifest is invalid");
  const archiveInfo = parsed.archiveInfo;
  const userInfo = parsed.userInfo;
  const generatedAt = record(archiveInfo)
    ? optionalDateTime(archiveInfo.generationDate)
    : undefined;
  const accountId =
    record(userInfo) && decimal(userInfo.accountId) ? userInfo.accountId : undefined;
  const dataTypes = parsed.dataTypes;
  if (!record(dataTypes)) throw new Error("X archive manifest data types are invalid");
  const tweetType = record(dataTypes.tweets)
    ? dataTypes.tweets
    : record(dataTypes.tweet)
      ? dataTypes.tweet
      : undefined;
  if (!tweetType || !Array.isArray(tweetType.files) || tweetType.files.length === 0) {
    throw new Error("X archive manifest does not declare tweet data");
  }
  const tweetFiles = archiveDataFiles(
    tweetType.files,
    /^YTD\.(?:tweet|tweets)\.part[0-9]+$/,
    "tweet",
  );
  const family = tweetFiles[0]!.globalName.split(".")[1];
  if (tweetFiles.some(({ globalName }) => globalName.split(".")[1] !== family)) {
    throw new Error("X archive manifest mixes tweet layouts");
  }
  const noteTweetType = dataTypes.noteTweet;
  if (noteTweetType !== undefined && !record(noteTweetType)) {
    throw new Error("X archive manifest Note Tweet data is invalid");
  }
  const noteTweetFiles = noteTweetType
    ? archiveDataFiles(noteTweetType.files, /^YTD\.note_tweet\.part[0-9]+$/, "Note Tweet", true)
    : [];
  return {
    ...(generatedAt ? { archiveGeneratedAt: generatedAt } : {}),
    ...(accountId ? { accountId } : {}),
    tweetFiles,
    noteTweetFiles,
  };
}

function archiveDataFiles(
  value: unknown,
  globalPattern: RegExp,
  label: string,
  allowEmpty = false,
): Array<{ path: string; globalName: string }> {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(`X archive manifest does not declare ${label} data`);
  }
  return value.map((file, index) => {
    if (
      !record(file) ||
      !safePath(file.fileName) ||
      typeof file.globalName !== "string" ||
      !globalPattern.test(file.globalName)
    ) {
      throw new Error(`X archive manifest ${label} file ${index} is invalid`);
    }
    return { path: file.fileName, globalName: file.globalName };
  });
}

export function parseRawArchiveAccount(value: unknown): XAccountIdentity & {
  archiveGeneratedAt?: string;
} {
  if (!Array.isArray(value) || value.length !== 1 || !record(value[0])) {
    throw new Error("X archive account record is invalid");
  }
  const account = value[0].account;
  if (!record(account) || !decimal(account.accountId)) {
    throw new Error("X archive account identity is invalid");
  }
  const handle = optionalString(account.username, 64);
  const name = optionalString(account.accountDisplayName, 256, true);
  const archiveGeneratedAt = optionalDateTime(account.archiveGeneratedAt);
  return {
    id: account.accountId,
    ...(handle ? { handle } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(archiveGeneratedAt ? { archiveGeneratedAt } : {}),
  };
}

export function parseRawArchiveTweets(value: unknown): RawXArchiveTweetEnvelope[] {
  if (!Array.isArray(value)) throw new Error("X archive tweets payload must be an array");
  return value.map((entry, index) => {
    if (
      !record(entry) ||
      !record(entry.tweet) ||
      (entry.noteTweet !== undefined && !record(entry.noteTweet))
    ) {
      throw new Error(`X archive tweet record ${index} is invalid`);
    }
    return {
      tweet: entry.tweet,
      ...(record(entry.noteTweet) ? { noteTweet: entry.noteTweet } : {}),
    };
  });
}

export function parseRawArchiveNoteTweets(value: unknown): Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) throw new Error("X archive Note Tweet payload must be an array");
  return value.map((entry, index) => {
    if (!record(entry) || !record(entry.noteTweet)) {
      throw new Error(`X archive Note Tweet record ${index} is invalid`);
    }
    parseCurrentNoteTweet(entry.noteTweet, index);
    return entry.noteTweet;
  });
}

/**
 * Current archives do not expose a tweet ID on Note Tweet rows. Associate by the exact creation
 * instant and the provider's truncated tweet-text prefix, rejecting missing or ambiguous matches.
 */
export function associateArchiveNoteTweets(
  tweets: readonly RawXArchiveTweetEnvelope[],
  noteTweets: readonly Readonly<Record<string, unknown>>[],
): RawXArchiveTweetEnvelope[] {
  const result: RawXArchiveTweetEnvelope[] = tweets.map(({ tweet }) => ({ tweet }));
  const claimedTweets = new Set<number>();
  const noteIds = new Set<string>();
  const tweetsByCreatedAt = new Map<
    string,
    Array<{
      readonly index: number;
      readonly id: string;
      readonly raw: Readonly<Record<string, unknown>>;
    }>
  >();
  for (const [index, { tweet: raw }] of tweets.entries()) {
    const id = requiredDecimal(raw.id_str, "tweet id");
    const publishedAt = twitterDateTime(raw.created_at, id);
    const sameInstant = tweetsByCreatedAt.get(publishedAt) ?? [];
    sameInstant.push({ index, id, raw });
    tweetsByCreatedAt.set(publishedAt, sameInstant);
  }
  for (const [noteIndex, rawNote] of noteTweets.entries()) {
    const note = parseCurrentNoteTweet(rawNote, noteIndex);
    if (noteIds.has(note.id)) throw new Error(`X archive repeats Note Tweet ${note.id}`);
    noteIds.add(note.id);
    const matches: number[] = [];
    for (const { index, id, raw } of tweetsByCreatedAt.get(note.createdAt) ?? []) {
      const rawText = requiredString(raw.full_text, `tweet ${id} text`, 1_000_000);
      const text = resolvedNoteTweetText(raw, rawText, note.text, id);
      if (text !== undefined) matches.push(index);
    }
    if (matches.length !== 1) {
      throw new Error(
        `X archive Note Tweet ${note.id} has ${matches.length === 0 ? "no" : "an ambiguous"} tweet association`,
      );
    }
    const index = matches[0]!;
    if (claimedTweets.has(index)) {
      throw new Error(
        `X archive tweet ${String(tweets[index]!.tweet.id_str)} repeats Note Tweet data`,
      );
    }
    claimedTweets.add(index);
    result[index] = { tweet: tweets[index]!.tweet, noteTweet: rawNote };
  }
  return result;
}

export function normalizeRawArchiveTweet(
  envelope: RawXArchiveTweetEnvelope,
  account: XAccountIdentity,
  mediaDirectory = "data/tweets_media",
): NormalizedRawArchivePost {
  const raw = envelope.tweet;
  const id = requiredDecimal(raw.id_str, "tweet id");
  const publishedAt = twitterDateTime(raw.created_at, id);
  const rawText = requiredString(raw.full_text, `tweet ${id} text`, 1_000_000);
  const associatedNote = envelope.noteTweet
    ? resolvedAssociatedNoteTweet(raw, rawText, publishedAt, envelope.noteTweet, id)
    : undefined;
  const text = associatedNote?.text ?? rawText;
  const archiveEntities = normalizeArchiveEntities(
    raw.entities,
    associatedNote ? rawText : text,
    id,
  );
  const entities = associatedNote
    ? mergeArchiveNoteEntities(
        text,
        archiveEntities,
        associatedNote.note.entities,
        associatedNote.prefix,
      )
    : archiveEntities;
  const references: NormalizedXPostReference[] = [];
  if (decimal(raw.in_reply_to_status_id_str)) {
    references.push({ kind: "replied_to", postId: raw.in_reply_to_status_id_str });
  }
  if (decimal(raw.retweeted_status_id_str)) {
    references.push({ kind: "reposted", postId: raw.retweeted_status_id_str });
  }
  if (decimal(raw.quoted_status_id_str)) {
    const quoteEntity = findQuoteEntity(entities, raw.quoted_status_id_str);
    if (!quoteEntity) {
      throw new Error(`X archive quoted post ${id} lacks one exact provider URL entity`);
    }
    references.push({
      kind: "quoted",
      postId: raw.quoted_status_id_str,
      url: quoteEntity.expanded_url,
      textUrl: quoteEntity.url,
      textSpan: { start: quoteEntity.start, end: quoteEntity.end },
    });
  }

  const media = archiveMedia(raw, id, mediaDirectory);
  const attachments: NormalizedXAttachment[] = media.map((item) =>
    item.declaredOmission
      ? {
          status: "omitted",
          reason: item.declaredOmission,
          sourceRef: item.sourcePath,
          ...(item.kind ? { kind: item.kind } : {}),
          ...(item.mime ? { mime: item.mime } : {}),
          ...(item.alt ? { alt: item.alt } : {}),
        }
      : {
          status: "available",
          kind: item.kind!,
          mime: item.mime!,
          sourceRef: item.sourcePath,
          ...(item.alt ? { alt: item.alt } : {}),
          bytes: new Uint8Array(),
        },
  );
  return {
    post: {
      id,
      authorId: account.id,
      canonicalUrl: `https://x.com/${account.handle ?? "i/web"}/status/${id}`,
      publishedAt,
      text,
      ...(account.handle ? { authorHandle: account.handle } : {}),
      ...(account.name !== undefined ? { authorName: account.name } : {}),
      ...(decimal(raw.conversation_id_str) ? { conversationId: raw.conversation_id_str } : {}),
      references,
      ...(isBareArchiveRepost(raw, rawText, id) ? { isRepost: true as const } : {}),
      ...(optionalString(raw.lang, 35) ? { language: raw.lang as string } : {}),
      ...(typeof raw.possibly_sensitive === "boolean"
        ? { possiblySensitive: raw.possibly_sensitive }
        : {}),
      ...(editHistory(raw, id).length ? { editHistoryIds: editHistory(raw, id) } : {}),
      ...(entities ? { entities } : {}),
      attachments,
    },
    media,
  };
}

interface ParsedCurrentNoteTweet {
  readonly id: string;
  readonly createdAt: string;
  readonly text: string;
  readonly entities: NormalizedXEntities | undefined;
}

function parseCurrentNoteTweet(
  value: Readonly<Record<string, unknown>>,
  index: number,
): ParsedCurrentNoteTweet {
  const id = requiredDecimal(value.noteTweetId, `Note Tweet ${index} id`);
  const createdAt = optionalDateTime(value.createdAt);
  const updatedAt = optionalDateTime(value.updatedAt);
  if (!createdAt || !updatedAt || !record(value.lifecycle) || !record(value.core)) {
    throw new Error(`X archive Note Tweet ${id} metadata is invalid`);
  }
  const lifecycle = value.lifecycle;
  for (const key of ["value", "name", "originalName"] as const) {
    if (typeof lifecycle[key] !== "string" || !lifecycle[key]) {
      throw new Error(`X archive Note Tweet ${id} lifecycle is invalid`);
    }
  }
  const core = value.core;
  const text = requiredString(core.text, `Note Tweet ${id} text`, 1_000_000);
  const styleTags =
    core.styletags === undefined ? [] : noteEntityArray(core.styletags, id, "style tags");
  if (styleTags.some((entry) => !record(entry))) {
    throw new Error(`X archive Note Tweet ${id} style tags are invalid`);
  }
  const entities = normalizeXEntities(text, {
    urls: noteEntityArray(core.urls, id, "URLs").map((entry, entityIndex) => {
      if (!record(entry)) throw new Error(`X archive Note Tweet ${id} URL is invalid`);
      const span = noteEntitySpan(entry, id, "URL", entityIndex);
      requiredString(entry.displayUrl, `Note Tweet ${id} display URL`, 8_192);
      return {
        url: requiredString(entry.shortUrl, `Note Tweet ${id} URL`, 8_192),
        expandedUrl: requiredString(entry.expandedUrl, `Note Tweet ${id} expanded URL`, 8_192),
        ...span,
      };
    }),
    mentions: noteEntityArray(core.mentions, id, "mentions").map((entry, entityIndex) => {
      if (!record(entry)) throw new Error(`X archive Note Tweet ${id} mention is invalid`);
      return {
        username: requiredString(entry.screenName, `Note Tweet ${id} mention username`, 15),
        ...noteEntitySpan(entry, id, "mention", entityIndex),
      };
    }),
    hashtags: noteEntityArray(core.hashtags, id, "hashtags").map((entry) => ({
      tag: requiredString(entry, `Note Tweet ${id} hashtag`, 256),
    })),
    cashtags: noteEntityArray(core.cashtags, id, "cashtags").map((entry) => ({
      tag: requiredString(entry, `Note Tweet ${id} cashtag`, 256),
    })),
  });
  return { id, createdAt, text, entities };
}

function noteEntityArray(value: unknown, noteId: string, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`X archive Note Tweet ${noteId} ${label} are invalid`);
  }
  return value;
}

function noteEntitySpan(
  value: Readonly<Record<string, unknown>>,
  noteId: string,
  label: string,
  index: number,
): { readonly start: number; readonly end: number } {
  if (
    typeof value.fromIndex !== "string" ||
    typeof value.toIndex !== "string" ||
    !CANONICAL_DECIMAL_INTEGER.test(value.fromIndex) ||
    !CANONICAL_DECIMAL_INTEGER.test(value.toIndex)
  ) {
    throw new Error(`X archive Note Tweet ${noteId} ${label} index ${index} is invalid`);
  }
  const start = Number(value.fromIndex);
  const end = Number(value.toIndex);
  if (!nonnegativeInteger(start) || !nonnegativeInteger(end) || end <= start) {
    throw new Error(`X archive Note Tweet ${noteId} ${label} index ${index} is invalid`);
  }
  return { start, end };
}

function resolvedAssociatedNoteTweet(
  raw: Readonly<Record<string, unknown>>,
  rawText: string,
  publishedAt: string,
  rawNote: Readonly<Record<string, unknown>>,
  postId: string,
): { readonly text: string; readonly prefix: string; readonly note: ParsedCurrentNoteTweet } {
  const note = parseCurrentNoteTweet(rawNote, 0);
  const resolved =
    note.createdAt === publishedAt
      ? resolvedNoteTweetText(raw, rawText, note.text, postId)
      : undefined;
  if (!resolved) {
    throw new Error(`X archive Note Tweet ${note.id} contradicts tweet ${postId}`);
  }
  return { ...resolved, note };
}

function resolvedNoteTweetText(
  raw: Readonly<Record<string, unknown>>,
  rawText: string,
  noteText: string,
  postId: string,
): { readonly text: string; readonly prefix: string } | undefined {
  if (!rawText.endsWith("…")) return undefined;
  const isReply = decimal(raw.in_reply_to_status_id_str);
  const prefix = isReply ? leadingReplyPrefix(raw, rawText, postId) : "";
  if (prefix === undefined) return undefined;
  const truncatedBody = rawText.slice(prefix.length, -1);
  if (
    truncatedBody.length === 0 ||
    noteText.length <= truncatedBody.length ||
    !noteText.startsWith(truncatedBody)
  ) {
    return undefined;
  }
  return { text: `${prefix}${noteText}`, prefix };
}

function leadingReplyPrefix(
  raw: Readonly<Record<string, unknown>>,
  text: string,
  postId: string,
): string | undefined {
  const expectedUsername = optionalString(raw.in_reply_to_screen_name, 15);
  const mentions = normalizeArchiveEntities(raw.entities, text, postId)?.mentions ?? [];
  if (!expectedUsername || mentions[0]?.start !== 0 || mentions[0].username !== expectedUsername) {
    return undefined;
  }
  let cursor = 0;
  let count = 0;
  for (const mention of mentions) {
    if (
      mention.start !== cursor ||
      text.slice(mention.start, mention.end) !== `@${mention.username}`
    ) {
      break;
    }
    cursor = mention.end;
    while (cursor < text.length && /\s/u.test(text[cursor]!)) cursor += 1;
    count += 1;
  }
  return count > 0 && cursor > mentions[count - 1]!.end ? text.slice(0, cursor) : undefined;
}

function mergeArchiveNoteEntities(
  text: string,
  archive: NormalizedXEntities | undefined,
  note: NormalizedXEntities | undefined,
  prefix: string,
): NormalizedXEntities | undefined {
  const input: XEntitiesInput = {
    urls: [
      ...(archive?.urls ?? [])
        .filter(({ end }) => end <= prefix.length)
        .map((entity) => ({
          url: entity.url,
          ...(entity.expanded_url ? { expandedUrl: entity.expanded_url } : {}),
          start: entity.start,
          end: entity.end,
        })),
      ...(note?.urls ?? []).map((entity) => ({
        url: entity.url,
        ...(entity.expanded_url ? { expandedUrl: entity.expanded_url } : {}),
        start: entity.start + prefix.length,
        end: entity.end + prefix.length,
      })),
    ],
    mentions: [
      ...(archive?.mentions ?? [])
        .filter(({ end }) => end <= prefix.length)
        .map((entity) => ({ ...entity })),
      ...(note?.mentions ?? []).map((entity) => ({
        ...entity,
        start: entity.start + prefix.length,
        end: entity.end + prefix.length,
      })),
    ],
    hashtags: [
      ...(archive?.hashtags ?? [])
        .filter(({ end }) => end <= prefix.length)
        .map((entity) => ({ ...entity })),
      ...(note?.hashtags ?? []).map((entity) => ({
        ...entity,
        start: entity.start + prefix.length,
        end: entity.end + prefix.length,
      })),
    ],
    cashtags: [
      ...(archive?.cashtags ?? [])
        .filter(({ end }) => end <= prefix.length)
        .map((entity) => ({ ...entity })),
      ...(note?.cashtags ?? []).map((entity) => ({
        ...entity,
        start: entity.start + prefix.length,
        end: entity.end + prefix.length,
      })),
    ],
  };
  return normalizeXEntities(text, input);
}

function isBareArchiveRepost(
  raw: Readonly<Record<string, unknown>>,
  text: string,
  postId: string,
): boolean {
  if (decimal(raw.retweeted_status_id_str)) return false;
  const mention = normalizeArchiveEntities(raw.entities, text, postId)?.mentions?.find(
    ({ start }) => start === 3,
  );
  return Boolean(
    mention &&
    text.startsWith("RT ") &&
    text.slice(3, mention.end) === `@${mention.username}` &&
    text[mention.end] === ":",
  );
}

export function assertSelectionManifest(
  value: unknown,
): asserts value is XArchiveSelectionManifest {
  if (!record(value) || value.format !== X_ARCHIVE_CAPTURE_FORMAT || !record(value.account)) {
    throw new Error("X archive selection manifest is invalid");
  }
  if (
    !decimal(value.account.id) ||
    !dateTime(value.selectedAt) ||
    !record(value.counts) ||
    !record(value.archiveLayout) ||
    !["tweet", "tweets"].includes(String(value.archiveLayout.tweetGlobal)) ||
    value.archiveLayout.mediaDirectory !== `data/${String(value.archiveLayout.tweetGlobal)}_media`
  ) {
    throw new Error("X archive selection manifest identity or counts are invalid");
  }
  if (
    (value.archiveGeneratedAt !== undefined && !dateTime(value.archiveGeneratedAt)) ||
    (value.account.handle !== undefined &&
      (typeof value.account.handle !== "string" || !value.account.handle)) ||
    (value.account.name !== undefined && typeof value.account.name !== "string")
  ) {
    throw new Error("X archive selection manifest account metadata is invalid");
  }
  const countKeys = [
    "sourceRecordCount",
    "repliesExcluded",
    "repostsExcluded",
    "quotesWithoutCommentaryExcluded",
    "authorMismatchesExcluded",
    "eligibleCount",
    "importedCount",
    "cap",
  ] as const;
  const counts = value.counts;
  if (countKeys.some((key) => !nonnegativeInteger(counts[key]))) {
    throw new Error("X archive selection counts are invalid");
  }
  if (!Array.isArray(value.includedMedia) || !Array.isArray(value.mediaOmissions)) {
    throw new Error("X archive selection media evidence is invalid");
  }
  for (const media of value.includedMedia) {
    if (
      !record(media) ||
      !decimal(media.postId) ||
      !nonnegativeInteger(media.attachmentIndex) ||
      !safePath(media.sourcePath) ||
      !safePath(media.capturePath) ||
      !["image", "video"].includes(String(media.kind)) ||
      typeof media.mime !== "string" ||
      !media.mime ||
      (media.alt !== undefined && typeof media.alt !== "string") ||
      !positiveInteger(media.byteSize) ||
      typeof media.contentHash !== "string" ||
      !HASH.test(media.contentHash)
    ) {
      throw new Error("X archive included-media evidence is invalid");
    }
  }
  for (const omission of value.mediaOmissions) {
    if (
      !record(omission) ||
      !decimal(omission.postId) ||
      !nonnegativeInteger(omission.attachmentIndex) ||
      !safePath(omission.sourcePath) ||
      !["missing_media", "unsupported_media", "element_too_large", "total_element_budget"].includes(
        String(omission.reason),
      ) ||
      (omission.kind !== undefined && !["image", "video"].includes(String(omission.kind))) ||
      (omission.mime !== undefined && (typeof omission.mime !== "string" || !omission.mime)) ||
      (omission.byteSize !== undefined && !nonnegativeInteger(omission.byteSize))
    ) {
      throw new Error("X archive media-omission evidence is invalid");
    }
  }
}

export function safePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1_024 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    !value.split("/").includes("..")
  );
}

function archiveMedia(
  raw: Readonly<Record<string, unknown>>,
  postId: string,
  mediaDirectory: string,
): XArchiveMediaDescriptor[] {
  const extended = raw.extended_entities;
  if (!record(extended) || !Array.isArray(extended.media)) return [];
  if (extended.media.length > X_ARCHIVE_MAX_POST_ATTACHMENTS) {
    throw new Error(`X tweet ${postId} has too many attachments`);
  }
  return extended.media.flatMap((value, index): XArchiveMediaDescriptor[] => {
    if (!record(value)) throw new Error(`X tweet ${postId} media ${index} is invalid`);
    const type = value.type;
    const alt = optionalString(value.ext_alt_text, 2_048, true);
    let url: string | undefined;
    let kind: "image" | "video";
    let mime: string;
    if (type === "photo") {
      url = optionalString(value.media_url_https, 4_096);
      kind = "image";
      mime = mimeForPath(url, "image/jpeg");
    } else if (type === "video" || type === "animated_gif") {
      const variants =
        record(value.video_info) && Array.isArray(value.video_info.variants)
          ? value.video_info.variants.filter(record)
          : [];
      const mp4 = variants
        .filter(
          (variant) => variant.content_type === "video/mp4" && typeof variant.url === "string",
        )
        .sort((left, right) => Number(right.bitrate ?? 0) - Number(left.bitrate ?? 0))[0];
      url = mp4?.url as string | undefined;
      kind = "video";
      mime = "video/mp4";
    } else {
      return [
        {
          sourcePath: `${mediaDirectory}/${postId}-attachment-${index}`,
          declaredOmission: "unsupported_media",
        },
      ];
    }
    if (!url) {
      return [
        {
          sourcePath: `${mediaDirectory}/${postId}-attachment-${index}`,
          kind,
          mime,
          ...(alt ? { alt } : {}),
          declaredOmission: "missing_media",
        },
      ];
    }
    const basename = urlBasename(url);
    return [
      {
        sourcePath: `${mediaDirectory}/${postId}-${basename}`,
        kind,
        mime,
        ...(alt ? { alt } : {}),
      },
    ];
  });
}

function normalizeArchiveEntities(
  value: unknown,
  text: string,
  postId: string,
): NormalizedXEntities | undefined {
  if (value === undefined) return undefined;
  if (!record(value)) throw new Error(`X archive tweet ${postId} entities are invalid`);
  return normalizeXEntities(text, {
    urls: archiveEntityArray(value, "urls", postId).map((entity, index) => {
      if (!record(entity) || typeof entity.url !== "string") {
        throw new Error(`X archive tweet ${postId} URL entity ${index} is invalid`);
      }
      if (entity.expanded_url !== undefined && typeof entity.expanded_url !== "string") {
        throw new Error(`X archive tweet ${postId} expanded URL entity ${index} is invalid`);
      }
      const span = archiveEntitySpan(entity, postId, "URL", index);
      return {
        url: entity.url,
        ...(entity.expanded_url !== undefined ? { expandedUrl: entity.expanded_url } : {}),
        ...span,
      };
    }),
    mentions: archiveEntityArray(value, "user_mentions", postId).map((entity, index) => {
      if (!record(entity) || typeof entity.screen_name !== "string") {
        throw new Error(`X archive tweet ${postId} mention entity ${index} is invalid`);
      }
      return {
        username: entity.screen_name,
        ...archiveEntitySpan(entity, postId, "mention", index),
      };
    }),
    hashtags: archiveEntityArray(value, "hashtags", postId).map((entity, index) => {
      if (!record(entity) || typeof entity.text !== "string") {
        throw new Error(`X archive tweet ${postId} hashtag entity ${index} is invalid`);
      }
      return {
        tag: entity.text,
        ...archiveEntitySpan(entity, postId, "hashtag", index),
      };
    }),
    cashtags: archiveEntityArray(value, "symbols", postId).map((entity, index) => {
      if (!record(entity) || typeof entity.text !== "string") {
        throw new Error(`X archive tweet ${postId} cashtag entity ${index} is invalid`);
      }
      return {
        tag: entity.text,
        ...archiveEntitySpan(entity, postId, "cashtag", index),
      };
    }),
  });
}

function archiveEntityArray(
  entities: Readonly<Record<string, unknown>>,
  key: string,
  postId: string,
): readonly unknown[] {
  const value = entities[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`X archive tweet ${postId} ${key} entities are invalid`);
  }
  return value;
}

function archiveEntitySpan(
  entity: Readonly<Record<string, unknown>>,
  postId: string,
  label: string,
  index: number,
): { readonly start?: number; readonly end?: number } {
  if (entity.indices === undefined) return {};
  if (!Array.isArray(entity.indices) || entity.indices.length !== 2) {
    throw new Error(`X archive tweet ${postId} ${label} entity indices ${index} are invalid`);
  }
  const [rawStart, rawEnd] = entity.indices;
  const homogeneous =
    (typeof rawStart === "number" && typeof rawEnd === "number") ||
    (typeof rawStart === "string" && typeof rawEnd === "string");
  const start = homogeneous ? archiveEntityIndex(rawStart) : undefined;
  const end = homogeneous ? archiveEntityIndex(rawEnd) : undefined;
  if (start === undefined || end === undefined || end <= start) {
    throw new Error(`X archive tweet ${postId} ${label} entity indices ${index} are invalid`);
  }
  return { start, end };
}

function findQuoteEntity(entities: NormalizedXEntities | undefined, quoteId: string) {
  const matches = (entities?.urls ?? []).filter(
    (entity): entity is NormalizedXUrlEntity & { readonly expanded_url: string } =>
      entity.expanded_url !== undefined && isXStatusUrl(entity.expanded_url, quoteId),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function parseAssignment(value: string, prefix: string, label: string): unknown {
  if (!value.startsWith(prefix)) throw new Error(`X archive ${label} assignment prefix is invalid`);
  let json = value.slice(prefix.length).trim();
  if (json.endsWith(";")) json = json.slice(0, -1).trimEnd();
  if (!json || (!json.startsWith("[") && !json.startsWith("{"))) {
    throw new Error(`X archive ${label} assignment has no JSON payload`);
  }
  try {
    return JSON.parse(json);
  } catch {
    throw new Error(`X archive ${label} assignment contains malformed JSON`);
  }
}

function editHistory(raw: Readonly<Record<string, unknown>>, fallback: string): string[] {
  const edit = raw.edit_info;
  if (!record(edit) || !record(edit.initial) || !Array.isArray(edit.initial.editTweetIds)) {
    return [fallback];
  }
  const ids = edit.initial.editTweetIds.filter(decimal);
  return ids.length ? [...new Set(ids)] : [fallback];
}

function twitterDateTime(value: unknown, id: string): string {
  const source = requiredString(value, `tweet ${id} created_at`, 128);
  const parsed = new Date(source);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`X tweet ${id} created_at is invalid`);
  return parsed.toISOString();
}

function urlBasename(value: string): string {
  const url = new URL(value);
  const name = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "");
  if (!safePath(name) || name.includes("/")) throw new Error("X media URL has an unsafe basename");
  return name;
}

function mimeForPath(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const pathname = new URL(value).pathname.toLowerCase();
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".gif")) return "image/gif";
  if (pathname.endsWith(".webp")) return "image/webp";
  return fallback;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function decimal(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_ID.test(value);
}

function requiredDecimal(value: unknown, label: string): string {
  if (!decimal(value)) throw new Error(`X archive ${label} is invalid`);
  return value;
}

function requiredString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value || value.length > maxLength) {
    throw new Error(`X archive ${label} is invalid`);
  }
  return value;
}

function optionalString(value: unknown, maxLength: number, allowEmpty = false): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > maxLength || (!allowEmpty && !value)) {
    throw new Error("X archive optional string is invalid");
  }
  return value;
}

function optionalDateTime(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !dateTime(value)) throw new Error("X archive date is invalid");
  return new Date(value).toISOString();
}

function dateTime(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function archiveEntityIndex(value: unknown): number | undefined {
  if (nonnegativeInteger(value)) return value;
  if (typeof value !== "string" || !CANONICAL_DECIMAL_INTEGER.test(value)) return undefined;
  const parsed = Number(value);
  return nonnegativeInteger(parsed) ? parsed : undefined;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
