import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { BlobNamespace } from "../config.ts";
import type { BlobStore, StoredBlob } from "./types.ts";

export class FileSystemBlobStore implements BlobStore {
  readonly #root: string;
  readonly #baseUrl: string;

  constructor(root: string, baseUrl: string) {
    this.#root = resolve(root);
    this.#baseUrl = baseUrl.replace(/\/$/, "");
  }

  #path(namespace: BlobNamespace, key: string): string {
    if (!/^sha256:[a-f0-9]{64}$/.test(key)) throw new Error("Invalid content-addressed blob key");
    return join(this.#root, namespace, key);
  }

  async put(
    namespace: BlobNamespace,
    key: string,
    bytes: Uint8Array,
    _contentType?: string,
  ): Promise<void> {
    const path = this.#path(namespace, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  }

  async get(namespace: BlobNamespace, key: string): Promise<StoredBlob | null> {
    try {
      return { bytes: await readFile(this.#path(namespace, key)) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(namespace: BlobNamespace, key: string): Promise<void> {
    await rm(this.#path(namespace, key), { force: true });
  }

  async signedUrl(namespace: BlobNamespace, key: string): Promise<string> {
    return `${this.#baseUrl}/rnet/v0/${namespace}/${encodeURIComponent(key)}/bytes`;
  }
}
