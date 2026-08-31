import { BlobReader, TextWriter, Uint8ArrayWriter, ZipReader, type Entry } from "@zip.js/zip.js";

import { safePath } from "./contracts.ts";

const MAX_ARCHIVE_ENTRIES = 100_000;
const MAX_COMPRESSION_RATIO = 1_000;

export interface ValidatedZip {
  readonly entries: readonly Entry[];
  readonly byPath: ReadonlyMap<string, Entry>;
  close(): Promise<void>;
}

export async function openValidatedZip(blob: Blob): Promise<ValidatedZip> {
  const reader = new ZipReader(new BlobReader(blob), { strictness: "strict" });
  try {
    const entries = await reader.getEntries({ strictness: "strict" });
    if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error("ZIP has too many entries");
    const byPath = new Map<string, Entry>();
    const folded = new Set<string>();
    for (const entry of entries) {
      if (!safePath(entry.filename))
        throw new Error(`ZIP contains an unsafe path: ${entry.filename}`);
      const key = entry.filename.toLocaleLowerCase("en-US");
      if (folded.has(key)) throw new Error(`ZIP contains a duplicate or case-conflicting path`);
      folded.add(key);
      byPath.set(entry.filename, entry);
      if (
        !entry.directory &&
        entry.uncompressedSize > 1_048_576 &&
        entry.uncompressedSize / Math.max(1, entry.compressedSize) > MAX_COMPRESSION_RATIO
      ) {
        throw new Error(`ZIP entry has an unsafe compression ratio: ${entry.filename}`);
      }
    }
    return {
      entries,
      byPath,
      close: () => reader.close(),
    };
  } catch (error) {
    await reader.close().catch(() => undefined);
    throw error;
  }
}

export async function readZipText(entry: Entry, maxBytes: number): Promise<string> {
  if (entry.directory || entry.uncompressedSize <= 0 || entry.uncompressedSize > maxBytes) {
    throw new Error(`ZIP text entry exceeds its limit: ${entry.filename}`);
  }
  const value = await entry.getData(new TextWriter());
  if (new TextEncoder().encode(value).byteLength > maxBytes) {
    throw new Error(`ZIP text entry exceeds its limit: ${entry.filename}`);
  }
  return value;
}

export async function readZipBytes(entry: Entry, maxBytes: number): Promise<Uint8Array> {
  if (entry.directory || entry.uncompressedSize <= 0 || entry.uncompressedSize > maxBytes) {
    throw new Error(`ZIP binary entry exceeds its limit: ${entry.filename}`);
  }
  const value = await entry.getData(new Uint8ArrayWriter());
  if (value.byteLength !== entry.uncompressedSize || value.byteLength > maxBytes) {
    throw new Error(`ZIP binary entry size changed while reading: ${entry.filename}`);
  }
  return value;
}
