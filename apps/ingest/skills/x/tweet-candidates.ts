import type { SourceExecutionLimits } from "../../../../packages/store-contract/src/source-skills.ts";

import {
  candidateBundle,
  type CandidateBundle,
  type SourceCandidateDraft,
  type SourceElementDraft,
  type SourceJsonObject,
} from "../../source-skills/candidate-bundle.ts";
import type {
  NormalizedXAttachment,
  NormalizedXPost,
  SelectedXPosts,
  XAccountIdentity,
  XEligiblePostKind,
  XMediaOmission,
  XPostExclusionReason,
} from "./contracts.ts";
import { sha256, sourceJsonObject } from "./contracts.ts";
import { verifyXPostCandidates } from "./verify.ts";

export type XPostDisposition =
  | { readonly eligible: true; readonly postKind: XEligiblePostKind }
  | { readonly eligible: false; readonly reason: XPostExclusionReason };

export class XPostCompilationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XPostCompilationError";
  }
}

export function classifyXPost(post: NormalizedXPost, ownerId: string): XPostDisposition {
  assertNormalizedXPost(post);
  if (post.authorId !== ownerId) return { eligible: false, reason: "author_mismatch" };
  if (post.references.some(({ kind }) => kind === "replied_to")) {
    return { eligible: false, reason: "reply" };
  }
  if (post.references.some(({ kind }) => kind === "reposted")) {
    return { eligible: false, reason: "repost" };
  }
  const quote = post.references.find(({ kind }) => kind === "quoted");
  if (!quote) return { eligible: true, postKind: "original" };

  const commentary = quote.textSpan
    ? `${post.text.slice(0, quote.textSpan.start)}${post.text.slice(quote.textSpan.end)}`
    : post.text;
  return /\S/u.test(commentary)
    ? { eligible: true, postKind: "quote" }
    : { eligible: false, reason: "quote_without_commentary" };
}

/** Applies exclusions before a deterministic newest-first cap. */
export function selectXPosts(input: {
  readonly account: XAccountIdentity;
  readonly posts: readonly NormalizedXPost[];
  readonly cap: number;
  readonly retrievedAt?: string;
}): SelectedXPosts {
  assertXId(input.account.id, "account id");
  if (!Number.isSafeInteger(input.cap) || input.cap <= 0) {
    throw new Error("X selection cap must be a positive safe integer");
  }
  if (input.retrievedAt !== undefined) assertDateTime(input.retrievedAt, "retrieval timestamp");

  const counts = {
    repliesExcluded: 0,
    repostsExcluded: 0,
    quotesWithoutCommentaryExcluded: 0,
    authorMismatchesExcluded: 0,
  };
  const eligible: NormalizedXPost[] = [];
  const sourceIds = new Set<string>();
  for (const post of input.posts) {
    assertNormalizedXPost(post);
    if (sourceIds.has(post.id)) throw new Error(`Duplicate X post id: ${post.id}`);
    sourceIds.add(post.id);
    const disposition = classifyXPost(post, input.account.id);
    if (disposition.eligible) eligible.push(post);
    else if (disposition.reason === "reply") counts.repliesExcluded += 1;
    else if (disposition.reason === "repost") counts.repostsExcluded += 1;
    else if (disposition.reason === "quote_without_commentary") {
      counts.quotesWithoutCommentaryExcluded += 1;
    } else counts.authorMismatchesExcluded += 1;
  }

  eligible.sort(compareXPostsNewestFirst);
  const posts = eligible.slice(0, input.cap);
  return {
    account: { ...input.account },
    ...(input.retrievedAt ? { retrievedAt: input.retrievedAt } : {}),
    posts,
    counts: {
      sourceRecordCount: input.posts.length,
      ...counts,
      eligibleCount: eligible.length,
      importedCount: posts.length,
      cap: input.cap,
    },
  };
}

export async function compileXPostCandidates(
  selection: SelectedXPosts,
  limits: SourceExecutionLimits,
): Promise<CandidateBundle> {
  if (selection.counts.cap !== limits.maxCandidates) {
    throw new XPostCompilationError("X selection cap does not match the effective source limit");
  }

  const omissions: XMediaOmission[] = [];
  const candidates: SourceCandidateDraft[] = [];
  let totalElementBytes = 0;
  for (const post of selection.posts) {
    const disposition = classifyXPost(post, selection.account.id);
    if (!disposition.eligible) {
      throw new XPostCompilationError(`Selected X post ${post.id} is not eligible`);
    }

    const textBytes = new TextEncoder().encode(post.text);
    if (textBytes.byteLength === 0 || textBytes.byteLength > limits.maxElementBytes) {
      throw new XPostCompilationError(`X post ${post.id} text exceeds the required element limit`);
    }
    if (totalElementBytes + textBytes.byteLength > limits.maxTotalElementBytes) {
      throw new XPostCompilationError("X post text exceeds the aggregate element budget");
    }
    const elements: SourceElementDraft[] = [
      await elementDraft("text", "text/plain", textBytes, undefined),
    ];
    totalElementBytes += textBytes.byteLength;

    for (const [attachmentIndex, attachment] of post.attachments.entries()) {
      const omission = mediaOmission(post.id, attachmentIndex, attachment);
      if (omission) {
        omissions.push(omission);
        continue;
      }
      const available = attachment as Extract<NormalizedXAttachment, { status: "available" }>;
      const byteSize = available.bytes.byteLength;
      if (byteSize === 0) {
        omissions.push({
          postId: post.id,
          attachmentIndex,
          sourceRef: available.sourceRef,
          reason: "missing_media",
          kind: available.kind,
          mime: available.mime,
          byteSize,
        });
        continue;
      }
      if (!supportedMedia(available.kind, available.mime)) {
        omissions.push({
          postId: post.id,
          attachmentIndex,
          sourceRef: available.sourceRef,
          reason: "unsupported_media",
          kind: available.kind,
          mime: available.mime,
          byteSize,
        });
        continue;
      }
      if (byteSize > limits.maxElementBytes) {
        omissions.push({
          postId: post.id,
          attachmentIndex,
          sourceRef: available.sourceRef,
          reason: "element_too_large",
          kind: available.kind,
          mime: available.mime,
          byteSize,
        });
        continue;
      }
      if (totalElementBytes + byteSize > limits.maxTotalElementBytes) {
        omissions.push({
          postId: post.id,
          attachmentIndex,
          sourceRef: available.sourceRef,
          reason: "total_element_budget",
          kind: available.kind,
          mime: available.mime,
          byteSize,
        });
        continue;
      }
      elements.push(
        await elementDraft(
          available.kind,
          available.mime,
          available.bytes,
          available.alt?.trim() ? available.alt : undefined,
        ),
      );
      totalElementBytes += byteSize;
    }

    const postOmissions = omissions.filter(({ postId }) => postId === post.id);
    const sourceProperties = postSourceProperties(post, disposition.postKind, postOmissions);
    const quote = post.references.find(({ kind }) => kind === "quoted");
    const keys = {
      x_tweet_id: post.id,
      x_author_id: post.authorId,
      canonical_url: post.canonicalUrl,
      ...(quote ? { x_quoted_tweet_id: quote.postId } : {}),
      ...(quote?.url ? { x_quoted_tweet_url: quote.url } : {}),
    };
    candidates.push({
      type: "tweet",
      keys,
      sourceProperties,
      ...(selection.retrievedAt ? { retrievedAt: selection.retrievedAt } : {}),
      elements,
      semanticIdentity: { type: "tweet", x_tweet_id: post.id, x_author_id: post.authorId },
      // Adapters never admit volatile engagement metrics, so every normalized source fact is
      // intentionally semantic, including declared media omissions.
      semanticSourceProperties: sourceProperties,
    });
  }

  const verify = await verifyXPostCandidates(selection, candidates, omissions);
  return candidateBundle(candidates, verify);
}

function postSourceProperties(
  post: NormalizedXPost,
  postKind: XEligiblePostKind,
  omissions: readonly XMediaOmission[],
): SourceJsonObject {
  return sourceJsonObject({
    published_at: post.publishedAt,
    ...(post.authorHandle ? { author_handle: post.authorHandle } : {}),
    ...(post.authorName ? { author_name: post.authorName } : {}),
    post_kind: postKind,
    ...(post.conversationId ? { conversation_id: post.conversationId } : {}),
    referenced_post_ids: post.references.map(({ postId }) => postId),
    ...(post.language ? { language: post.language } : {}),
    ...(post.possiblySensitive !== undefined ? { possibly_sensitive: post.possiblySensitive } : {}),
    ...(post.editHistoryIds ? { edit_history_ids: post.editHistoryIds } : {}),
    ...(post.entities ? { entities: post.entities } : {}),
    ...(omissions.length
      ? {
          media_omissions: omissions.map((omission) => ({
            attachment_index: omission.attachmentIndex,
            source_ref: omission.sourceRef,
            reason: omission.reason,
            ...(omission.kind ? { kind: omission.kind } : {}),
            ...(omission.mime ? { mime: omission.mime } : {}),
            ...(omission.byteSize !== undefined ? { byte_size: omission.byteSize } : {}),
          })),
        }
      : {}),
  });
}

function mediaOmission(
  postId: string,
  attachmentIndex: number,
  attachment: NormalizedXAttachment,
): XMediaOmission | undefined {
  if (attachment.status === "available") return undefined;
  return {
    postId,
    attachmentIndex,
    sourceRef: attachment.sourceRef,
    reason: attachment.reason,
    ...(attachment.kind ? { kind: attachment.kind } : {}),
    ...(attachment.mime ? { mime: attachment.mime } : {}),
    ...(attachment.byteSize !== undefined ? { byteSize: attachment.byteSize } : {}),
  };
}

function supportedMedia(kind: "image" | "video", mime: string): boolean {
  return kind === "image"
    ? ["image/gif", "image/jpeg", "image/png", "image/webp"].includes(mime)
    : mime === "video/mp4";
}

async function elementDraft(
  kind: "text" | "image" | "video",
  mime: string,
  bytes: Uint8Array,
  alt: string | undefined,
): Promise<SourceElementDraft> {
  return {
    role: "content",
    ...(alt ? { alt } : {}),
    kind,
    mime,
    bytes,
    byteSize: bytes.byteLength,
    contentHash: await sha256(bytes),
  };
}

export function compareXPostsNewestFirst(left: NormalizedXPost, right: NormalizedXPost): number {
  const time = Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
  if (time !== 0) return time;
  if (left.id.length !== right.id.length) return right.id.length - left.id.length;
  return right.id.localeCompare(left.id);
}

export function assertNormalizedXPost(post: NormalizedXPost): void {
  assertXId(post.id, "post id");
  assertXId(post.authorId, `post ${post.id} author id`);
  assertDateTime(post.publishedAt, `post ${post.id} publication timestamp`);
  if (!post.text || !new TextEncoder().encode(post.text).byteLength) {
    throw new Error(`X post ${post.id} has no exact text payload`);
  }
  if (
    (post.authorHandle !== undefined &&
      (!post.authorHandle.trim() || post.authorHandle.length > 64)) ||
    (post.authorName !== undefined && post.authorName.length > 256) ||
    (post.language !== undefined && (!post.language || post.language.length > 35))
  ) {
    throw new Error(`X post ${post.id} has invalid author or language facts`);
  }
  const url = new URL(post.canonicalUrl);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "x.com" ||
    !url.pathname.endsWith(`/status/${post.id}`) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(`X post ${post.id} has an invalid canonical URL`);
  }
  if (post.conversationId) assertXId(post.conversationId, `post ${post.id} conversation id`);
  const referenceKinds = new Set<string>();
  for (const reference of post.references) {
    assertXId(reference.postId, `post ${post.id} reference id`);
    if (referenceKinds.has(reference.kind)) {
      throw new Error(`X post ${post.id} repeats a ${reference.kind} reference`);
    }
    referenceKinds.add(reference.kind);
    if (reference.textSpan) {
      if (
        reference.kind !== "quoted" ||
        !reference.textUrl ||
        !Number.isSafeInteger(reference.textSpan.start) ||
        !Number.isSafeInteger(reference.textSpan.end) ||
        reference.textSpan.start < 0 ||
        reference.textSpan.end <= reference.textSpan.start ||
        reference.textSpan.end > post.text.length
      ) {
        throw new Error(`X post ${post.id} has an invalid quote URL span`);
      }
      if (post.text.slice(reference.textSpan.start, reference.textSpan.end) !== reference.textUrl) {
        throw new Error(`X post ${post.id} quote URL span does not match its exact text`);
      }
    } else if (reference.textUrl !== undefined) {
      throw new Error(`X post ${post.id} has a quote text URL without its span`);
    }
  }
  if (post.editHistoryIds) {
    const editIds = new Set<string>();
    for (const id of post.editHistoryIds) {
      assertXId(id, `post ${post.id} edit-history id`);
      if (editIds.has(id)) throw new Error(`X post ${post.id} repeats an edit-history id`);
      editIds.add(id);
    }
  }
  const attachmentRefs = new Set<string>();
  for (const attachment of post.attachments) {
    if (!attachment.sourceRef || attachmentRefs.has(attachment.sourceRef)) {
      throw new Error(`X post ${post.id} has a missing or duplicate media reference`);
    }
    attachmentRefs.add(attachment.sourceRef);
    if (attachment.status === "available" && !(attachment.bytes instanceof Uint8Array)) {
      throw new Error(`X post ${post.id} has invalid media bytes`);
    }
    if (
      attachment.status === "omitted" &&
      attachment.byteSize !== undefined &&
      (!Number.isSafeInteger(attachment.byteSize) || attachment.byteSize < 0)
    ) {
      throw new Error(`X post ${post.id} has an invalid omitted media size`);
    }
  }
}

function assertXId(value: string, label: string): void {
  if (!/^[0-9]+$/.test(value)) throw new Error(`X ${label} must be a decimal identifier`);
}

function assertDateTime(value: string, label: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error(`X ${label} is invalid`);
  }
}
