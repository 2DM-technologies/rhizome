import type { ServerConfig } from "../config.ts";
import { FileSystemBlobStore } from "./fs.ts";
import { R2BlobStore } from "./r2.ts";

export type { BlobStore, StoredBlob } from "./types.ts";

export function createBlobStore(config: ServerConfig) {
  return config.blob.driver === "fs"
    ? new FileSystemBlobStore(config.blob.root, config.baseUrl)
    : new R2BlobStore(config.blob);
}
