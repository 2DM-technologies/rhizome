import type { SourceParser } from "../../../source-skills/candidate-bundle.ts";
import { sha256 } from "../contracts.ts";
import type { NormalizedXAttachment, NormalizedXPost, SelectedXPosts } from "../contracts.ts";
import { X_POST_PARSER_NAME, X_POST_PARSER_VERSION } from "../definition.ts";
import {
  X_ARCHIVE_ACCOUNT_PATH,
  X_ARCHIVE_MANIFEST_PATH,
  X_ARCHIVE_POSTS_PATH,
  assertSelectionManifest,
  normalizeRawArchiveTweet,
  parseRawArchiveTweets,
  type XArchiveIncludedMedia,
  type XArchiveMediaOmission,
} from "./contracts.ts";
import { openValidatedZip, readZipBytes, readZipText } from "./zip.ts";

const MAX_MANIFEST_BYTES = 2 * 1_024 * 1_024;
const MAX_POSTS_BYTES = 32 * 1_024 * 1_024;

export const xArchiveParser: SourceParser<SelectedXPosts> = {
  name: X_POST_PARSER_NAME,
  version: X_POST_PARSER_VERSION,
  async parse(bytes) {
    const ownedBytes = new Uint8Array(bytes.byteLength);
    ownedBytes.set(bytes);
    const capture = await openValidatedZip(new Blob([ownedBytes.buffer]));
    try {
      const manifestEntry = capture.byPath.get(X_ARCHIVE_MANIFEST_PATH);
      const accountEntry = capture.byPath.get(X_ARCHIVE_ACCOUNT_PATH);
      const postsEntry = capture.byPath.get(X_ARCHIVE_POSTS_PATH);
      if (!manifestEntry || !accountEntry || !postsEntry) {
        throw new Error("X selection capture is missing required entries");
      }
      const manifest = JSON.parse(await readZipText(manifestEntry, MAX_MANIFEST_BYTES)) as unknown;
      assertSelectionManifest(manifest);
      const account = JSON.parse(await readZipText(accountEntry, 64 * 1_024)) as unknown;
      if (!sameAccount(account, manifest.account)) {
        throw new Error("X selection capture account contradicts its manifest");
      }
      const rawTweets = parseRawArchiveTweets(
        JSON.parse(await readZipText(postsEntry, MAX_POSTS_BYTES)) as unknown,
      );
      if (rawTweets.length !== manifest.counts.importedCount) {
        throw new Error("X selection capture post count contradicts its manifest");
      }
      const declaredPaths = new Set([
        X_ARCHIVE_MANIFEST_PATH,
        X_ARCHIVE_ACCOUNT_PATH,
        X_ARCHIVE_POSTS_PATH,
        ...manifest.includedMedia.map(({ capturePath }) => capturePath),
      ]);
      for (const entry of capture.entries) {
        if (!entry.directory && !declaredPaths.has(entry.filename)) {
          throw new Error(`X selection capture has an undeclared entry: ${entry.filename}`);
        }
      }
      if (declaredPaths.size !== 3 + manifest.includedMedia.length) {
        throw new Error("X selection capture repeats a media path");
      }

      const included = indexedEvidence(manifest.includedMedia, "included");
      const omitted = indexedEvidence(manifest.mediaOmissions, "omitted");
      const posts: NormalizedXPost[] = [];
      for (const envelope of rawTweets) {
        const normalized = normalizeRawArchiveTweet(
          envelope,
          manifest.account,
          manifest.archiveLayout.mediaDirectory,
        );
        const attachments: NormalizedXAttachment[] = [];
        for (const [attachmentIndex, descriptor] of normalized.media.entries()) {
          const key = mediaKey(normalized.post.id, attachmentIndex);
          const media = included.get(key);
          const omission = omitted.get(key);
          if (Boolean(media) === Boolean(omission)) {
            throw new Error(`X selection media ${key} lacks exactly one disposition`);
          }
          if (media) {
            if (
              descriptor.declaredOmission ||
              media.sourcePath !== descriptor.sourcePath ||
              media.kind !== descriptor.kind ||
              media.mime !== descriptor.mime ||
              media.alt !== descriptor.alt
            ) {
              throw new Error(`X selection media ${key} contradicts the source record`);
            }
            const entry = capture.byPath.get(media.capturePath);
            if (!entry)
              throw new Error(`X selection media payload is missing: ${media.capturePath}`);
            const payload = await readZipBytes(entry, media.byteSize);
            if (
              payload.byteLength !== media.byteSize ||
              (await sha256(payload)) !== media.contentHash
            ) {
              throw new Error(`X selection media integrity failed: ${media.capturePath}`);
            }
            attachments.push({
              status: "available",
              kind: media.kind,
              mime: media.mime,
              sourceRef: media.sourcePath,
              ...(media.alt ? { alt: media.alt } : {}),
              bytes: payload,
            });
          } else {
            if (
              omission!.sourcePath !== descriptor.sourcePath ||
              (descriptor.declaredOmission && omission!.reason !== descriptor.declaredOmission)
            ) {
              throw new Error(`X selection omission ${key} contradicts the source record`);
            }
            attachments.push({
              status: "omitted",
              reason: omission!.reason,
              sourceRef: omission!.sourcePath,
              ...(omission!.kind ? { kind: omission!.kind } : {}),
              ...(omission!.mime ? { mime: omission!.mime } : {}),
              ...(omission!.byteSize !== undefined ? { byteSize: omission!.byteSize } : {}),
            });
          }
        }
        posts.push({ ...normalized.post, attachments });
      }
      if (
        included.size + omitted.size !==
        posts.reduce((sum, post) => sum + post.attachments.length, 0)
      ) {
        throw new Error("X selection media evidence contains orphan records");
      }
      return {
        account: manifest.account,
        retrievedAt: manifest.selectedAt,
        posts,
        counts: manifest.counts,
      };
    } finally {
      await capture.close();
    }
  },
};

function indexedEvidence<T extends XArchiveIncludedMedia | XArchiveMediaOmission>(
  values: readonly T[],
  label: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = mediaKey(value.postId, value.attachmentIndex);
    if (result.has(key)) throw new Error(`X selection repeats ${label} media evidence: ${key}`);
    result.set(key, value);
  }
  return result;
}

function mediaKey(postId: string, attachmentIndex: number): string {
  return `${postId}:${attachmentIndex}`;
}

function sameAccount(
  value: unknown,
  expected: { id: string; handle?: string; name?: string },
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const account = value as Record<string, unknown>;
  return (
    account.id === expected.id &&
    account.handle === expected.handle &&
    account.name === expected.name &&
    Object.keys(account).every((key) => ["id", "handle", "name"].includes(key))
  );
}
