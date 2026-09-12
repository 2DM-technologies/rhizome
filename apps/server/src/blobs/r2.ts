import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { BlobNamespace } from "../config.ts";
import type { BlobStore, StoredBlob } from "./types.ts";

export interface R2BlobStoreOptions {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  buckets: Record<BlobNamespace, string>;
  forcePathStyle?: boolean;
}

export class R2BlobStore implements BlobStore {
  readonly #client: S3Client;
  readonly #buckets: Record<BlobNamespace, string>;

  constructor(options: R2BlobStoreOptions) {
    this.#client = new S3Client({
      region: "auto",
      endpoint: options.endpoint,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
      forcePathStyle: options.forcePathStyle,
    });
    this.#buckets = options.buckets;
  }

  async put(
    namespace: BlobNamespace,
    key: string,
    bytes: Uint8Array,
    contentType?: string,
  ): Promise<void> {
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#buckets[namespace],
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
  }

  async get(
    namespace: BlobNamespace,
    key: string,
    signal?: AbortSignal,
  ): Promise<StoredBlob | null> {
    signal?.throwIfAborted();
    try {
      const response = await this.#client.send(
        new GetObjectCommand({ Bucket: this.#buckets[namespace], Key: key }),
        { abortSignal: signal },
      );
      if (!response.Body) return null;
      const body = response.Body;
      // The SDK request can finish before its body does. Keep cancellation attached until
      // the Node/Bun response stream has been fully consumed, including a stalled body.
      let abort: (() => void) | undefined;
      try {
        const reading = body.transformToByteArray();
        const bytes = signal
          ? await Promise.race([
              reading,
              new Promise<never>((_resolve, reject) => {
                abort = () => {
                  reject(signal.reason);
                  if ("destroy" in body) body.destroy();
                };
                signal.addEventListener("abort", abort, { once: true });
                if (signal.aborted) abort();
              }),
            ])
          : await reading;
        signal?.throwIfAborted();
        return { bytes, contentType: response.ContentType };
      } finally {
        if (abort) signal?.removeEventListener("abort", abort);
      }
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status === 404) return null;
      throw error;
    }
  }

  async delete(namespace: BlobNamespace, key: string): Promise<void> {
    await this.#client.send(
      new DeleteObjectCommand({ Bucket: this.#buckets[namespace], Key: key }),
    );
  }

  async signedUrl(namespace: BlobNamespace, key: string, expiresInSeconds = 900): Promise<string> {
    return getSignedUrl(
      this.#client,
      new GetObjectCommand({ Bucket: this.#buckets[namespace], Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
}
