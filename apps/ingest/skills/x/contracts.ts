import type { SourceJsonObject, SourceJsonValue } from "../../source-skills/candidate-bundle.ts";

export type XPostReferenceKind = "replied_to" | "quoted" | "reposted";
export type XEligiblePostKind = "original" | "quote";
export type XPostExclusionReason =
  "author_mismatch" | "reply" | "repost" | "quote_without_commentary";

/** JavaScript UTF-16 string offsets after a provider adapter has normalized its native indices. */
export interface XTextSpan {
  readonly start: number;
  readonly end: number;
}

/** Canonical source-fact shape shared by archive v1 and API v2 URL entities. */
export interface NormalizedXUrlEntity extends XTextSpan {
  readonly url: string;
  readonly expanded_url?: string;
}

export interface NormalizedXMentionEntity extends XTextSpan {
  readonly username: string;
}

export interface NormalizedXTagEntity extends XTextSpan {
  readonly tag: string;
}

export interface NormalizedXEntities {
  readonly urls?: readonly NormalizedXUrlEntity[];
  readonly mentions?: readonly NormalizedXMentionEntity[];
  readonly hashtags?: readonly NormalizedXTagEntity[];
  readonly cashtags?: readonly NormalizedXTagEntity[];
}

export interface NormalizedXPostReference {
  readonly kind: XPostReferenceKind;
  readonly postId: string;
  /** Stable target URL, when supplied by the provider. */
  readonly url?: string;
  /** Only the provider-identified quoted-post URL span is removed for commentary classification. */
  readonly textSpan?: XTextSpan;
  /** Exact URL token occupying textSpan; it may be a short URL while url is expanded. */
  readonly textUrl?: string;
}

export type XDeclaredMediaOmissionReason = "missing_media" | "unsupported_media";
export type XMediaOmissionReason =
  XDeclaredMediaOmissionReason | "element_too_large" | "total_element_budget";

interface NormalizedXAttachmentBase {
  readonly sourceRef: string;
  readonly alt?: string;
}

export type NormalizedXAttachment =
  | (NormalizedXAttachmentBase & {
      readonly status: "available";
      readonly kind: "image" | "video";
      readonly mime: string;
      readonly bytes: Uint8Array;
    })
  | (NormalizedXAttachmentBase & {
      readonly status: "omitted";
      readonly reason: XMediaOmissionReason;
      readonly kind?: "image" | "video";
      readonly mime?: string;
      readonly byteSize?: number;
    });

export interface NormalizedXPost {
  readonly id: string;
  readonly authorId: string;
  readonly canonicalUrl: string;
  readonly publishedAt: string;
  /** Exact source text. Adapters must not expand or rewrite URL text. */
  readonly text: string;
  readonly authorHandle?: string;
  readonly authorName?: string;
  readonly conversationId?: string;
  /** Provider-native entity dialects are adapter input; stable link facts normalize here. */
  readonly references: readonly NormalizedXPostReference[];
  readonly language?: string;
  readonly possiblySensitive?: boolean;
  readonly editHistoryIds?: readonly string[];
  readonly entities?: NormalizedXEntities;
  readonly attachments: readonly NormalizedXAttachment[];
}

export interface XAccountIdentity {
  readonly id: string;
  readonly handle?: string;
  readonly name?: string;
}

export interface XSelectionCounts {
  readonly sourceRecordCount: number;
  readonly repliesExcluded: number;
  readonly repostsExcluded: number;
  readonly quotesWithoutCommentaryExcluded: number;
  readonly authorMismatchesExcluded: number;
  readonly eligibleCount: number;
  readonly importedCount: number;
  readonly cap: number;
}

export interface SelectedXPosts {
  readonly account: XAccountIdentity;
  readonly retrievedAt?: string;
  readonly posts: readonly NormalizedXPost[];
  readonly counts: XSelectionCounts;
}

export interface XMediaOmission {
  readonly postId: string;
  readonly attachmentIndex: number;
  readonly sourceRef: string;
  readonly reason: XMediaOmissionReason;
  readonly kind?: "image" | "video";
  readonly mime?: string;
  readonly byteSize?: number;
}

export type XVerifyCheckName =
  | "record_accounting"
  | "candidate_count"
  | "required_fields"
  | "unique_post_ids"
  | "eligibility"
  | "newest_first"
  | "element_integrity"
  | "media_accounting";

export interface XVerifyReport {
  readonly ok: boolean;
  readonly source_record_count: number;
  readonly replies_excluded: number;
  readonly reposts_excluded: number;
  readonly quotes_without_commentary_excluded: number;
  readonly author_mismatches_excluded: number;
  readonly eligible_count: number;
  readonly candidate_count: number;
  readonly configured_cap: number;
  readonly element_count: number;
  readonly total_element_bytes: number;
  readonly media_omissions: Readonly<Record<XMediaOmissionReason, number>>;
  readonly checks: readonly {
    readonly name: XVerifyCheckName;
    readonly ok: boolean;
    readonly detail: string;
  }[];
}

export function sourceJsonObject(value: Readonly<Record<string, unknown>>): SourceJsonObject {
  const converted = sourceJsonValue(value, new Set(), "X source properties");
  if (!converted || typeof converted !== "object" || Array.isArray(converted)) {
    throw new Error("X source properties must be a JSON object");
  }
  return converted as SourceJsonObject;
}

export async function sha256(bytes: Uint8Array): Promise<`sha256:${string}`> {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", owned.buffer);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return `sha256:${hex}`;
}

function sourceJsonValue(value: unknown, ancestors: Set<object>, label: string): SourceJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object") throw new Error(`${label} is not JSON-safe`);
  if (ancestors.has(value)) throw new Error(`${label} contains a cycle`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => sourceJsonValue(entry, ancestors, label));
    }
    const result: SourceJsonObject = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) throw new Error(`${label}.${key} is undefined`);
      result[key] = sourceJsonValue(entry, ancestors, `${label}.${key}`);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}
