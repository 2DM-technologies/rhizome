import type { SourceExecutionLimits } from "../../../../../packages/store-contract/src/source-skills.ts";
import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from "@zip.js/zip.js";

import type { PreparedSourceCapture } from "../../../file-sources/preprocessing.ts";
import { sha256 } from "../contracts.ts";
import { selectXPosts } from "../tweet-candidates.ts";
import {
  X_ARCHIVE_CAPTURE_FORMAT,
  X_ARCHIVE_CAPTURE_MIME,
  X_ARCHIVE_MANIFEST_PATH,
  X_ARCHIVE_POSTS_PATH,
  associateArchiveNoteTweets,
  normalizeRawArchiveTweet,
  parseArchiveAssignment,
  parseArchiveDataAssignment,
  parseArchiveNoteTweetDataAssignment,
  parseRawArchiveAccount,
  parseRawArchiveManifest,
  parseRawArchiveNoteTweets,
  parseRawArchiveTweets,
  type RawXArchiveTweetEnvelope,
  type ParsedRawArchiveNoteTweet,
  type XArchiveIncludedMedia,
  type XArchiveMediaOmission,
  type XArchiveSelectionManifest,
} from "./contracts.ts";
import { openValidatedZip, readZipBytes, readZipText } from "./zip.ts";

const ACCOUNT_SOURCE_PATH = "data/account.js";
const MANIFEST_SOURCE_PATH = "data/manifest.js";
const MAX_METADATA_BYTES = 32 * 1_024 * 1_024;

export async function prepareXArchiveCapture(
  file: File,
  limits: SourceExecutionLimits,
  now: () => Date = () => new Date(),
): Promise<PreparedSourceCapture> {
  const archive = await openValidatedZip(file);
  try {
    const accountEntry = archive.byPath.get(ACCOUNT_SOURCE_PATH);
    if (!accountEntry) throw new Error("X archive is missing account data");
    const accountRaw = parseArchiveAssignment(
      await readZipText(accountEntry, MAX_METADATA_BYTES),
      "account",
    );
    const account = parseRawArchiveAccount(accountRaw);
    const sourceManifestEntry = archive.byPath.get(MANIFEST_SOURCE_PATH);
    const sourceManifest = sourceManifestEntry
      ? parseRawArchiveManifest(await readZipText(sourceManifestEntry, MAX_METADATA_BYTES))
      : undefined;
    if (sourceManifest?.accountId && sourceManifest.accountId !== account.id) {
      throw new Error("X archive manifest account contradicts account data");
    }
    const tweetFiles = sourceManifest?.tweetFiles ?? fallbackTweetFiles(archive.byPath);
    const noteTweetFiles = sourceManifest?.noteTweetFiles ?? fallbackNoteTweetFiles(archive.byPath);
    const tweetGlobal = tweetFiles[0]!.globalName.includes(".tweets.") ? "tweets" : "tweet";
    const mediaDirectory = `data/${tweetGlobal}_media` as "data/tweet_media" | "data/tweets_media";
    const tweets: RawXArchiveTweetEnvelope[] = [];
    const metadataEntries = [
      accountEntry,
      ...(sourceManifestEntry ? [sourceManifestEntry] : []),
      ...tweetFiles.map(({ path }) => archive.byPath.get(path)),
      ...noteTweetFiles.map(({ path }) => archive.byPath.get(path)),
    ];
    if (
      metadataEntries.some((entry) => !entry) ||
      metadataEntries.reduce((total, entry) => total + (entry?.uncompressedSize ?? 0), 0) >
        MAX_METADATA_BYTES
    ) {
      throw new Error("X archive account, manifest, and tweet data exceed the metadata limit");
    }
    for (const tweetFile of tweetFiles) {
      const entry = archive.byPath.get(tweetFile.path);
      if (!entry) throw new Error(`X archive is missing declared tweet data: ${tweetFile.path}`);
      tweets.push(
        ...parseRawArchiveTweets(
          parseArchiveDataAssignment(
            await readZipText(entry, MAX_METADATA_BYTES),
            tweetFile.globalName,
          ),
        ),
      );
    }
    const noteTweets: ParsedRawArchiveNoteTweet[] = [];
    for (const noteTweetFile of noteTweetFiles) {
      const entry = archive.byPath.get(noteTweetFile.path);
      if (!entry) {
        throw new Error(`X archive is missing declared Note Tweet data: ${noteTweetFile.path}`);
      }
      noteTweets.push(
        ...parseRawArchiveNoteTweets(
          parseArchiveNoteTweetDataAssignment(
            await readZipText(entry, MAX_METADATA_BYTES),
            noteTweetFile.globalName,
          ),
        ),
      );
    }
    const tweetsWithNotes = associateArchiveNoteTweets(tweets, noteTweets);
    const normalized = tweetsWithNotes.map((tweet) =>
      normalizeRawArchiveTweet(tweet, account, mediaDirectory),
    );
    const selection = selectXPosts({
      account,
      posts: normalized.map(({ post }) => post),
      cap: limits.maxCandidates,
      retrievedAt: now().toISOString(),
    });
    const rawById = new Map(
      tweetsWithNotes.map((tweet) => [String(tweet.tweet.id_str), tweet] as const),
    );
    const normalizedById = new Map(normalized.map((item) => [item.post.id, item] as const));
    const includedMedia: XArchiveIncludedMedia[] = [];
    const mediaOmissions: XArchiveMediaOmission[] = [];
    const mediaPayloads = new Map<string, Uint8Array>();
    const textByteSizes = selection.posts.map(
      (post) => new TextEncoder().encode(post.text).byteLength,
    );
    if (textByteSizes.some((byteSize) => byteSize === 0 || byteSize > limits.maxElementBytes)) {
      throw new Error("Selected X post text exceeds the per-element budget");
    }
    let totalElementBytes = textByteSizes.reduce((sum, byteSize) => sum + byteSize, 0);
    if (totalElementBytes > limits.maxTotalElementBytes) {
      throw new Error("Selected X post text exceeds the aggregate element budget");
    }

    for (const post of selection.posts) {
      const descriptors = normalizedById.get(post.id)?.media ?? [];
      for (const [attachmentIndex, descriptor] of descriptors.entries()) {
        if (descriptor.declaredOmission) {
          mediaOmissions.push({
            postId: post.id,
            attachmentIndex,
            sourcePath: descriptor.sourcePath,
            reason: descriptor.declaredOmission,
            ...(descriptor.kind ? { kind: descriptor.kind } : {}),
            ...(descriptor.mime ? { mime: descriptor.mime } : {}),
          });
          continue;
        }
        const entry = archive.byPath.get(descriptor.sourcePath);
        if (!entry) {
          mediaOmissions.push({
            postId: post.id,
            attachmentIndex,
            sourcePath: descriptor.sourcePath,
            reason: "missing_media",
            kind: descriptor.kind!,
            mime: descriptor.mime!,
          });
          continue;
        }
        if (entry.uncompressedSize > limits.maxElementBytes) {
          mediaOmissions.push({
            postId: post.id,
            attachmentIndex,
            sourcePath: descriptor.sourcePath,
            reason: "element_too_large",
            kind: descriptor.kind!,
            mime: descriptor.mime!,
            byteSize: entry.uncompressedSize,
          });
          continue;
        }
        if (totalElementBytes + entry.uncompressedSize > limits.maxTotalElementBytes) {
          mediaOmissions.push({
            postId: post.id,
            attachmentIndex,
            sourcePath: descriptor.sourcePath,
            reason: "total_element_budget",
            kind: descriptor.kind!,
            mime: descriptor.mime!,
            byteSize: entry.uncompressedSize,
          });
          continue;
        }
        const bytes = await readZipBytes(entry, limits.maxElementBytes);
        const capturePath = `media/${String(includedMedia.length).padStart(4, "0")}-${safeBasename(descriptor.sourcePath)}`;
        const media: XArchiveIncludedMedia = {
          postId: post.id,
          attachmentIndex,
          sourcePath: descriptor.sourcePath,
          capturePath,
          kind: descriptor.kind!,
          mime: descriptor.mime!,
          ...(descriptor.alt ? { alt: descriptor.alt } : {}),
          byteSize: bytes.byteLength,
          contentHash: await sha256(bytes),
        };
        includedMedia.push(media);
        mediaPayloads.set(capturePath, bytes);
        totalElementBytes += bytes.byteLength;
      }
    }

    const selectedRaw = selection.posts.map((post) => {
      const raw = rawById.get(post.id);
      if (!raw) throw new Error(`Selected X post ${post.id} disappeared`);
      return raw;
    });
    const selectedAt = now().toISOString();
    const manifest: XArchiveSelectionManifest = {
      format: X_ARCHIVE_CAPTURE_FORMAT,
      ...(sourceManifest?.archiveGeneratedAt
        ? { archiveGeneratedAt: sourceManifest.archiveGeneratedAt }
        : account.archiveGeneratedAt
          ? { archiveGeneratedAt: account.archiveGeneratedAt }
          : {}),
      selectedAt,
      archiveLayout: { tweetGlobal, mediaDirectory },
      account: {
        id: account.id,
        ...(account.handle ? { handle: account.handle } : {}),
        ...(account.name !== undefined ? { name: account.name } : {}),
      },
      counts: selection.counts,
      includedMedia,
      mediaOmissions,
    };
    const writer = new ZipWriter(new BlobWriter(X_ARCHIVE_CAPTURE_MIME));
    await writer.add(X_ARCHIVE_MANIFEST_PATH, new TextReader(JSON.stringify(manifest)));
    await writer.add(X_ARCHIVE_POSTS_PATH, new TextReader(JSON.stringify(selectedRaw)));
    for (const media of includedMedia) {
      await writer.add(
        media.capturePath,
        new Uint8ArrayReader(mediaPayloads.get(media.capturePath)!),
      );
    }
    const blob = await writer.close();
    if (blob.size <= 0 || blob.size > limits.maxCaptureBytes) {
      throw new Error("Prepared X archive capture exceeds its capture limit");
    }
    const handle = account.handle ? `-${account.handle}` : "";
    return {
      blob,
      label: `x-archive${handle}-selection.zip`,
      mime: X_ARCHIVE_CAPTURE_MIME,
    };
  } finally {
    await archive.close();
  }
}

function fallbackTweetFiles(byPath: ReadonlyMap<string, unknown>) {
  if (byPath.has("data/tweets.js")) {
    return [{ path: "data/tweets.js", globalName: "YTD.tweets.part0" }] as const;
  }
  if (byPath.has("data/tweet.js")) {
    return [{ path: "data/tweet.js", globalName: "YTD.tweet.part0" }] as const;
  }
  throw new Error("X archive is missing tweet data");
}

function fallbackNoteTweetFiles(byPath: ReadonlyMap<string, unknown>) {
  return byPath.has("data/note-tweet.js")
    ? ([{ path: "data/note-tweet.js", globalName: "YTD.note_tweet.part0" }] as const)
    : [];
}

export const xArchivePreprocessorRegistration = {
  implementation: "x_archive_selection",
  version: "x-archive-selection-worker@1",
  createWorker() {
    return new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  },
};

function safeBasename(path: string): string {
  return path
    .split("/")
    .at(-1)!
    .replaceAll(/[^A-Za-z0-9._-]/g, "_");
}
