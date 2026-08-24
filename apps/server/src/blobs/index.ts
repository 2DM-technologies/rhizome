import type { ServerConfig } from "../config.ts";
import { R2BlobStore } from "./r2.ts";

export type { BlobStore, StoredBlob } from "./types.ts";

export function createBlobStore(config: ServerConfig) {
  return new R2BlobStore(config.blob);
}
