import { BlobReader, Uint8ArrayWriter, ZipReader, type Entry } from "@zip.js/zip.js";

const MAX_ARCHIVE_ENTRIES = 100_000;
const MAX_COMPRESSION_RATIO = 1_000;
const MAX_TOTAL_EXPANDED_BYTES = 512 * 1_024 * 1_024;
const entryBudgets = new WeakMap<Entry, { remaining: number }>();

export interface ValidatedZip {
  readonly entries: readonly Entry[];
  readonly byPath: ReadonlyMap<string, Entry>;
  close(): Promise<void>;
}

export async function openValidatedZip(
  blob: Blob,
  maxEntries = MAX_ARCHIVE_ENTRIES,
  maxTotalExpandedBytes = MAX_TOTAL_EXPANDED_BYTES,
): Promise<ValidatedZip> {
  if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0 || maxEntries > MAX_ARCHIVE_ENTRIES) {
    throw new Error("ZIP entry limit is invalid");
  }
  if (!Number.isSafeInteger(maxTotalExpandedBytes) || maxTotalExpandedBytes <= 0) {
    throw new Error("ZIP total expanded-byte limit is invalid");
  }
  const budget = { remaining: maxTotalExpandedBytes };
  const reader = new ZipReader(new BlobReader(blob), { strictness: "strict" });
  try {
    const entries: Entry[] = [];
    const byPath = new Map<string, Entry>();
    const folded = new Set<string>();
    for await (const entry of reader.getEntriesGenerator({ strictness: "strict" })) {
      if (entries.length >= maxEntries) throw new Error("ZIP has too many entries");
      entries.push(entry);
      if (!safePath(entry.filename))
        throw new Error(`ZIP contains an unsafe path: ${entry.filename}`);
      const key = entry.filename.toLocaleLowerCase("en-US");
      if (folded.has(key)) throw new Error(`ZIP contains a duplicate or case-conflicting path`);
      folded.add(key);
      byPath.set(entry.filename, entry);
      if (
        !Number.isSafeInteger(entry.uncompressedSize) ||
        entry.uncompressedSize < 0 ||
        !Number.isSafeInteger(entry.compressedSize) ||
        entry.compressedSize < 0 ||
        entry.encrypted
      ) {
        throw new Error("ZIP contains invalid sizes or an encrypted entry");
      }
      entryBudgets.set(entry, budget);
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
  const bytes = await readZipBytes(entry, maxBytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`ZIP text entry is not valid UTF-8: ${entry.filename}`);
  }
}

export async function readZipBytes(entry: Entry, maxBytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new Error("ZIP entry byte limit is invalid");
  if (entry.directory || entry.uncompressedSize <= 0 || entry.uncompressedSize > maxBytes) {
    throw new Error(`ZIP binary entry exceeds its limit: ${entry.filename}`);
  }
  const budget = entryBudgets.get(entry);
  if (!budget) throw new Error("ZIP entry was not validated");
  // Reserve before decompression; concurrent reads cannot each spend the same allowance.
  if (entry.uncompressedSize > budget.remaining)
    throw new Error("ZIP total expanded-byte limit exceeded");
  budget.remaining -= entry.uncompressedSize;
  const value = await entry.getData(
    new BoundedUint8ArrayWriter(Math.min(maxBytes, entry.uncompressedSize)),
    { checkSignature: true },
  );
  if (value.byteLength !== entry.uncompressedSize || value.byteLength > maxBytes) {
    throw new Error(`ZIP binary entry size changed while reading: ${entry.filename}`);
  }
  return value;
}

class BoundedUint8ArrayWriter extends Uint8ArrayWriter {
  readonly #maxBytes: number;
  #writtenBytes = 0;

  constructor(maxBytes: number) {
    super(Math.min(maxBytes, 64 * 1_024));
    this.#maxBytes = maxBytes;
  }

  override async writeUint8Array(value: Uint8Array): Promise<void> {
    if (this.#writtenBytes + value.byteLength > this.#maxBytes) {
      throw new Error("ZIP entry exceeded its limit while decompressing");
    }
    this.#writtenBytes += value.byteLength;
    await super.writeUint8Array(value);
  }
}

/** Rejects absolute, escaping, and NUL-bearing entry names before any entry is read. */
function safePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1_024 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    !value
      .split("/")
      .some(
        (segment, index, segments) =>
          segment === ".." || segment === "." || (segment === "" && index !== segments.length - 1),
      ) &&
    !/^[A-Za-z]:/.test(value)
  );
}
