import type { SourceCandidateDraft } from "../../source-skills/candidate-bundle.ts";

import type {
  SelectedXPosts,
  XMediaOmission,
  XMediaOmissionReason,
  XVerifyReport,
} from "./contracts.ts";
import { sha256 } from "./contracts.ts";
import {
  classifyXPost,
  compareXPostsNewestFirst,
  type XPostDisposition,
} from "./tweet-candidates.ts";

const HASH = /^sha256:[a-f0-9]{64}$/;

export async function verifyXPostCandidates(
  selection: SelectedXPosts,
  candidates: readonly SourceCandidateDraft[],
  omissions: readonly XMediaOmission[],
): Promise<XVerifyReport> {
  const counts = selection.counts;
  const excluded =
    counts.repliesExcluded +
    counts.repostsExcluded +
    counts.quotesWithoutCommentaryExcluded +
    counts.authorMismatchesExcluded;
  const recordAccounting =
    nonnegativeInteger(counts.sourceRecordCount) &&
    nonnegativeInteger(counts.eligibleCount) &&
    counts.sourceRecordCount === counts.eligibleCount + excluded;
  const candidateCount =
    candidates.length === selection.posts.length &&
    candidates.length === counts.importedCount &&
    counts.importedCount === Math.min(counts.eligibleCount, counts.cap);
  const ids = selection.posts.map(({ id }) => id);
  const uniquePostIds = new Set(ids).size === ids.length;
  const newestFirst = selection.posts.every(
    (post, index) =>
      index === 0 || compareXPostsNewestFirst(selection.posts[index - 1]!, post) <= 0,
  );
  let requiredFields = true;
  let eligibility = true;
  let elementIntegrity = true;
  let elementCount = 0;
  let totalElementBytes = 0;
  let includedMedia = 0;

  for (const [index, post] of selection.posts.entries()) {
    let disposition: XPostDisposition;
    try {
      disposition = classifyXPost(post, selection.account.id);
    } catch {
      requiredFields = false;
      eligibility = false;
      continue;
    }
    eligibility &&= disposition.eligible;
    const candidate = candidates[index];
    if (!candidate) {
      elementIntegrity = false;
      continue;
    }
    requiredFields &&=
      candidate.type === "tweet" &&
      candidate.keys.x_tweet_id === post.id &&
      candidate.keys.x_author_id === post.authorId &&
      candidate.keys.canonical_url === post.canonicalUrl &&
      candidate.sourceProperties.text === undefined &&
      candidate.sourceProperties.full_text === undefined;
    const [text, ...media] = candidate.elements;
    const expectedText = new TextEncoder().encode(post.text);
    elementIntegrity &&=
      Boolean(text) &&
      text?.role === "content" &&
      text.kind === "text" &&
      text.mime === "text/plain" &&
      equalBytes(text.bytes, expectedText);
    includedMedia += media.length;
    for (const element of candidate.elements) {
      elementCount += 1;
      totalElementBytes += element.bytes.byteLength;
      elementIntegrity &&=
        element.byteSize === element.bytes.byteLength &&
        element.byteSize > 0 &&
        HASH.test(element.contentHash) &&
        element.contentHash === (await sha256(element.bytes)) &&
        ((element.kind === "text" && element.mime === "text/plain") ||
          (element.kind === "image" && element.mime.startsWith("image/")) ||
          (element.kind === "video" && element.mime === "video/mp4"));
    }
  }

  const attachmentCount = selection.posts.reduce((sum, post) => sum + post.attachments.length, 0);
  const mediaAccounting = includedMedia + omissions.length === attachmentCount;
  const omissionCounts: Record<XMediaOmissionReason, number> = {
    missing_media: 0,
    unsupported_media: 0,
    element_too_large: 0,
    total_element_budget: 0,
  };
  for (const omission of omissions) omissionCounts[omission.reason] += 1;

  const checks: XVerifyReport["checks"] = [
    {
      name: "record_accounting",
      ok: recordAccounting,
      detail: `${counts.sourceRecordCount} records examined: ${counts.eligibleCount} eligible and ${excluded} excluded`,
    },
    {
      name: "candidate_count",
      ok: candidateCount,
      detail: `${candidates.length} imported from ${counts.eligibleCount} eligible posts with cap ${counts.cap}`,
    },
    {
      name: "required_fields",
      ok: requiredFields,
      detail: requiredFields
        ? "Every candidate preserves stable post/author keys and stores text only as an element"
        : "A candidate is missing or contradicts required stable X facts",
    },
    {
      name: "unique_post_ids",
      ok: uniquePostIds,
      detail: uniquePostIds ? "Selected X post IDs are unique" : "A selected X post ID is repeated",
    },
    {
      name: "eligibility",
      ok: eligibility,
      detail: eligibility
        ? `${counts.repliesExcluded} replies, ${counts.repostsExcluded} reposts, and ${counts.quotesWithoutCommentaryExcluded} quotes without commentary excluded`
        : "A selected post is not an authored original or commentary-bearing quote",
    },
    {
      name: "newest_first",
      ok: newestFirst,
      detail: newestFirst
        ? "Candidates are newest-first with stable post-ID tie-breaking"
        : "Candidate order is not deterministic newest-first order",
    },
    {
      name: "element_integrity",
      ok: elementIntegrity && Number.isSafeInteger(totalElementBytes),
      detail: `${elementCount} elements cover ${totalElementBytes} bytes with exact text and matching integrity evidence`,
    },
    {
      name: "media_accounting",
      ok: mediaAccounting,
      detail: `${includedMedia} media included and ${omissions.length} omitted across ${attachmentCount} source attachments`,
    },
  ];

  return {
    ok: checks.every(({ ok }) => ok),
    source_record_count: counts.sourceRecordCount,
    replies_excluded: counts.repliesExcluded,
    reposts_excluded: counts.repostsExcluded,
    quotes_without_commentary_excluded: counts.quotesWithoutCommentaryExcluded,
    author_mismatches_excluded: counts.authorMismatchesExcluded,
    eligible_count: counts.eligibleCount,
    candidate_count: candidates.length,
    configured_cap: counts.cap,
    element_count: elementCount,
    total_element_bytes: totalElementBytes,
    media_omissions: omissionCounts,
    checks,
  };
}

function nonnegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}
