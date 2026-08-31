export const CANDIDATE_BUNDLE_CAPABILITY = "candidate_bundle@1" as const;

export type SourceJsonValue =
  boolean | number | string | null | SourceJsonValue[] | { [key: string]: SourceJsonValue };

export type SourceJsonObject = { [key: string]: SourceJsonValue };

export type SourceElementKind = "text" | "image" | "audio" | "video" | "document";
export type SourceElementRole = "title" | "content" | "preview";

export interface SourceElementDraft {
  readonly role: SourceElementRole;
  readonly kind: SourceElementKind;
  readonly mime: string;
  readonly bytes: Uint8Array;
  readonly byteSize: number;
  readonly contentHash: `sha256:${string}`;
}

/**
 * Provider-neutral material emitted by every installed source after parsing and source VERIFY.
 * Array order is semantic: generic staging commits candidates and elements in this exact order.
 */
export interface SourceCandidateDraft {
  readonly type: string;
  readonly keys: Readonly<Record<string, string>>;
  readonly sourceProperties: SourceJsonObject;
  readonly retrievedAt?: string;
  readonly elements: readonly SourceElementDraft[];
  /** Opaque, JSON-safe stable identity selected by the source rather than inferred by the server. */
  readonly semanticIdentity: SourceJsonValue;
  /** Stable source facts used for change detection; defaults to all source properties. */
  readonly semanticSourceProperties?: SourceJsonObject;
}

export interface SourceVerifyCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** Additional report fields must also be JSON-safe before generic staging persists them. */
export interface SourceVerifyReport {
  readonly ok: boolean;
  readonly checks: readonly SourceVerifyCheck[];
}

export interface CandidateBundle<Verify extends SourceVerifyReport = SourceVerifyReport> {
  readonly kind: typeof CANDIDATE_BUNDLE_CAPABILITY;
  readonly candidates: readonly SourceCandidateDraft[];
  readonly verify: Verify;
}

export interface SourceParser<Output = unknown> {
  readonly name: string;
  readonly version: string;
  parse(bytes: Uint8Array): Promise<Output>;
}

/**
 * The compiled-source boundary. Capture kinds choose how bytes arrive; the server invokes this
 * capability without branching on a provider, skill id, object type, or parser name.
 */
export interface CandidateBundleCapability<Input> {
  readonly kind: typeof CANDIDATE_BUNDLE_CAPABILITY;
  compile(input: Input): Promise<CandidateBundle>;
  /** Optional source-owned control flow for a failed VERIFY report. */
  verificationError?(report: SourceVerifyReport): Error | undefined;
}

export function candidateBundle<Verify extends SourceVerifyReport>(
  candidates: readonly SourceCandidateDraft[],
  verify: Verify,
): CandidateBundle<Verify> {
  return { kind: CANDIDATE_BUNDLE_CAPABILITY, candidates, verify };
}
