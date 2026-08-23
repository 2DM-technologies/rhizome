import type { BlobNamespace } from "../config.ts";

export interface StoredBlob {
  bytes: Uint8Array;
  contentType?: string;
}

export interface BlobStore {
  put(namespace: BlobNamespace, key: string, bytes: Uint8Array, contentType?: string): Promise<void>;
  get(namespace: BlobNamespace, key: string): Promise<StoredBlob | null>;
  delete(namespace: BlobNamespace, key: string): Promise<void>;
  signedUrl(namespace: BlobNamespace, key: string, expiresInSeconds?: number): Promise<string>;
}
