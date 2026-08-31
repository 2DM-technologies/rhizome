import type { SourceExecutionLimits } from "../../../../../packages/store-contract/src/source-skills.ts";
import { TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";

import { ConnectedSourceError } from "../../../connected-sources/types.ts";
import { sha256 } from "../contracts.ts";
import { X_OAUTH_SKILL_ID } from "../definition.ts";
import { XApiClient, XApiClientError } from "./client.ts";
import { parseXOAuthSecret } from "./oauth.ts";
import {
  X_OAUTH_CAPTURE_FORMAT,
  X_OAUTH_MANIFEST_PATH,
  X_OAUTH_TIMELINE_PATH,
  normalizeXOAuthTimeline,
  type XOAuthCaptureManifest,
  type XOAuthIncludedMedia,
  type XOAuthMediaOmission,
  type XOAuthTimelineRequestEvidence,
} from "./parser.ts";

const SUPPORTED_IMAGE_MIMES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

export interface XOAuthTimelineCaptureInput {
  readonly client: XApiClient;
  /** Opaque provider-owned token-set JSON supplied by the generic sealed-credential boundary. */
  readonly secret: string;
  readonly limits: SourceExecutionLimits;
  readonly signal: AbortSignal;
  readonly request?: Pick<XOAuthTimelineRequestEvidence, "startTime" | "previousCheckpoint">;
  readonly now?: () => Date;
}

/** Fetches exactly one provider page and stores a compact, versioned capture with binary media. */
export async function captureXOAuthTimeline(
  input: XOAuthTimelineCaptureInput,
): Promise<Uint8Array> {
  input.signal.throwIfAborted();
  const credential = parseXOAuthSecret(input.secret);
  const retrievedAt = (input.now ?? (() => new Date()))().toISOString();
  const request = timelineRequestEvidence(input.request);

  let identity: Awaited<ReturnType<XApiClient["getAuthenticatedUser"]>>;
  let timeline: Awaited<ReturnType<XApiClient["getUserTimeline"]>>;
  try {
    identity = await input.client.getAuthenticatedUser(credential.accessToken, input.signal);
    input.signal.throwIfAborted();
    if (identity.id !== credential.account.id) {
      throw new ConnectedSourceError(X_OAUTH_SKILL_ID, {
        status: 422,
        code: "source_connection_failed",
        title: "X connection needs attention",
        detail: "The connected X account identity changed and must be connected again",
      });
    }
    timeline = await input.client.getUserTimeline(
      credential.accessToken,
      identity.id,
      request.startTime ? { startTime: request.startTime } : {},
      input.signal,
    );
    input.signal.throwIfAborted();
  } catch (error) {
    input.signal.throwIfAborted();
    throw captureFailure(error, "X could not retrieve the account timeline");
  }

  const account = { id: identity.id, handle: identity.username, name: identity.name };
  const normalized = normalizeXOAuthTimeline({
    account,
    timeline,
    limits: input.limits,
    retrievedAt,
    ...(request.previousCheckpoint ? { previousCheckpoint: request.previousCheckpoint } : {}),
  });
  input.signal.throwIfAborted();
  const includedMedia: XOAuthIncludedMedia[] = [];
  const mediaOmissions: XOAuthMediaOmission[] = [];
  const payloads = new Map<string, Uint8Array>();
  const textByteSizes = normalized.selection.posts.map(
    (post) => new TextEncoder().encode(post.text).byteLength,
  );
  if (textByteSizes.some((size) => size <= 0 || size > input.limits.maxElementBytes)) {
    throw new ConnectedSourceError(X_OAUTH_SKILL_ID, {
      status: 422,
      code: "payload_too_large",
      title: "X capture exceeds its limits",
      detail: "A selected X post text element exceeds its element byte limit",
    });
  }
  let totalElementBytes = textByteSizes.reduce((total, size) => total + size, 0);
  if (totalElementBytes > input.limits.maxTotalElementBytes) {
    throw new ConnectedSourceError(X_OAUTH_SKILL_ID, {
      status: 422,
      code: "payload_too_large",
      title: "X capture exceeds its limits",
      detail: "The selected X post text exceeds the aggregate element limit",
    });
  }

  for (const post of normalized.selection.posts) {
    input.signal.throwIfAborted();
    const descriptors = normalized.mediaByPostId.get(post.id) ?? [];
    for (const [attachmentIndex, descriptor] of descriptors.entries()) {
      input.signal.throwIfAborted();
      if (descriptor.declaredOmission || !descriptor.sourceUrl || !descriptor.kind) {
        mediaOmissions.push({
          postId: post.id,
          attachmentIndex,
          mediaKey: descriptor.mediaKey,
          ...(descriptor.sourceUrl ? { sourceUrl: descriptor.sourceUrl } : {}),
          reason: descriptor.declaredOmission ?? "missing_media",
          ...(descriptor.kind ? { kind: descriptor.kind } : {}),
          ...(descriptor.mime ? { mime: descriptor.mime } : {}),
        });
        continue;
      }

      let fetched: Awaited<ReturnType<XApiClient["fetchMedia"]>>;
      try {
        fetched = await input.client.fetchMedia(descriptor.sourceUrl, {
          maximumBytes: input.limits.maxElementBytes,
          signal: input.signal,
        });
        input.signal.throwIfAborted();
      } catch (error) {
        input.signal.throwIfAborted();
        const omission = mediaFetchOmission(error, {
          postId: post.id,
          attachmentIndex,
          mediaKey: descriptor.mediaKey,
          sourceUrl: descriptor.sourceUrl,
          kind: descriptor.kind,
          ...(descriptor.mime ? { mime: descriptor.mime } : {}),
        });
        if (omission) {
          mediaOmissions.push(omission);
          continue;
        }
        throw captureFailure(error, "X could not retrieve selected media");
      }

      const mime = normalizedMediaMime(descriptor.kind, descriptor.mime, fetched.mime);
      if (!mime) {
        mediaOmissions.push({
          postId: post.id,
          attachmentIndex,
          mediaKey: descriptor.mediaKey,
          sourceUrl: descriptor.sourceUrl,
          reason: "unsupported_media",
          kind: descriptor.kind,
          ...(fetched.mime ? { mime: fetched.mime } : {}),
          byteSize: fetched.bytes.byteLength,
        });
        continue;
      }
      if (fetched.bytes.byteLength === 0) {
        mediaOmissions.push({
          postId: post.id,
          attachmentIndex,
          mediaKey: descriptor.mediaKey,
          sourceUrl: descriptor.sourceUrl,
          reason: "missing_media",
          kind: descriptor.kind,
          mime,
          byteSize: 0,
        });
        continue;
      }
      if (totalElementBytes + fetched.bytes.byteLength > input.limits.maxTotalElementBytes) {
        mediaOmissions.push({
          postId: post.id,
          attachmentIndex,
          mediaKey: descriptor.mediaKey,
          sourceUrl: descriptor.sourceUrl,
          reason: "total_element_budget",
          kind: descriptor.kind,
          mime,
          byteSize: fetched.bytes.byteLength,
        });
        continue;
      }

      const capturePath = `media/${String(includedMedia.length).padStart(4, "0")}-${safeMediaKey(descriptor.mediaKey)}`;
      input.signal.throwIfAborted();
      const contentHash = await sha256(fetched.bytes);
      input.signal.throwIfAborted();
      const included: XOAuthIncludedMedia = {
        postId: post.id,
        attachmentIndex,
        mediaKey: descriptor.mediaKey,
        sourceUrl: descriptor.sourceUrl,
        capturePath,
        kind: descriptor.kind,
        mime,
        ...(descriptor.alt?.trim() ? { alt: descriptor.alt } : {}),
        byteSize: fetched.bytes.byteLength,
        contentHash,
      };
      includedMedia.push(included);
      payloads.set(capturePath, fetched.bytes);
      totalElementBytes += fetched.bytes.byteLength;
    }
  }

  const manifest: XOAuthCaptureManifest = {
    format: X_OAUTH_CAPTURE_FORMAT,
    retrievedAt,
    account,
    limits: { ...input.limits },
    request,
    ...(normalized.checkpoint ? { checkpoint: normalized.checkpoint } : {}),
    counts: normalized.selection.counts,
    selectedPostIds: normalized.selection.posts.map(({ id }) => id),
    includedMedia,
    mediaOmissions,
  };
  input.signal.throwIfAborted();
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add(X_OAUTH_MANIFEST_PATH, new TextReader(JSON.stringify(manifest)), {
    signal: input.signal,
  });
  input.signal.throwIfAborted();
  await writer.add(X_OAUTH_TIMELINE_PATH, new TextReader(JSON.stringify(timeline)), {
    signal: input.signal,
  });
  input.signal.throwIfAborted();
  for (const media of includedMedia) {
    input.signal.throwIfAborted();
    await writer.add(media.capturePath, new Uint8ArrayReader(payloads.get(media.capturePath)!), {
      level: 0,
      signal: input.signal,
    });
    input.signal.throwIfAborted();
  }
  input.signal.throwIfAborted();
  const bytes = await writer.close();
  input.signal.throwIfAborted();
  if (bytes.byteLength <= 0 || bytes.byteLength > input.limits.maxCaptureBytes) {
    throw new ConnectedSourceError(X_OAUTH_SKILL_ID, {
      status: 422,
      code: "payload_too_large",
      title: "X capture exceeds its limits",
      detail: "The prepared X capture exceeds its capture byte limit",
    });
  }
  input.signal.throwIfAborted();
  return bytes;
}

function timelineRequestEvidence(
  request: XOAuthTimelineCaptureInput["request"],
): XOAuthTimelineRequestEvidence {
  if (request?.startTime && request.startTime !== request.previousCheckpoint?.overlapStartTime) {
    throw new Error("X timeline edit-overlap request is inconsistent");
  }
  if (!request?.startTime && request?.previousCheckpoint) {
    throw new Error("X timeline checkpoint requires an overlap start time");
  }
  return {
    maxResults: 100,
    exclude: ["replies", "retweets"],
    ...(request?.startTime ? { startTime: request.startTime } : {}),
    ...(request?.previousCheckpoint ? { previousCheckpoint: request.previousCheckpoint } : {}),
  };
}

function mediaFetchOmission(
  error: unknown,
  base: Omit<XOAuthMediaOmission, "reason" | "byteSize">,
): XOAuthMediaOmission | undefined {
  if (!(error instanceof XApiClientError)) return undefined;
  if (error.kind === "response_too_large") {
    return {
      ...base,
      reason: "element_too_large",
      ...(error.evidence.declaredByteSize !== undefined
        ? { byteSize: error.evidence.declaredByteSize }
        : {}),
    };
  }
  if (error.kind === "unsafe_endpoint") return { ...base, reason: "unsupported_media" };
  if (
    error.kind === "provider_rejected" &&
    error.evidence.httpStatus !== undefined &&
    error.evidence.httpStatus >= 400 &&
    error.evidence.httpStatus < 500 &&
    error.evidence.httpStatus !== 429
  ) {
    return { ...base, reason: "missing_media" };
  }
  return undefined;
}

function normalizedMediaMime(
  kind: "image" | "video",
  declared: string | undefined,
  response: string | undefined,
): string | undefined {
  if (kind === "video") {
    return declared === "video/mp4" && (!response || response === "video/mp4")
      ? "video/mp4"
      : undefined;
  }
  return response && SUPPORTED_IMAGE_MIMES.has(response) ? response : undefined;
}

function safeMediaKey(value: string): string {
  const safe = value.replaceAll(/[^A-Za-z0-9._-]/gu, "_").slice(0, 200);
  return safe || "media";
}

function captureFailure(error: unknown, fallback: string): ConnectedSourceError {
  if (error instanceof ConnectedSourceError) return error;
  if (error instanceof XApiClientError) {
    if (error.kind === "rate_limited") {
      return new ConnectedSourceError(X_OAUTH_SKILL_ID, {
        status: 429,
        code: "rate_limited",
        title: "X request limit reached",
        detail:
          "X temporarily limited this import request; try again after the provider window resets",
        extensions: {
          ...(error.evidence.retryAfterSeconds !== undefined
            ? { retry_after_seconds: error.evidence.retryAfterSeconds }
            : {}),
          ...(error.evidence.rateLimitResetEpoch !== undefined
            ? { rate_limit_reset_epoch: error.evidence.rateLimitResetEpoch }
            : {}),
        },
      });
    }
    if (error.kind === "unauthorized" || error.kind === "token_rejected") {
      return new ConnectedSourceError(X_OAUTH_SKILL_ID, {
        status: 422,
        code: "source_connection_failed",
        title: "X connection needs attention",
        detail: "The X connection is invalid or expired and must be connected again",
      });
    }
  }
  return new ConnectedSourceError(X_OAUTH_SKILL_ID, {
    status: 422,
    code: "source_connection_failed",
    title: "X import failed",
    detail: fallback,
  });
}
