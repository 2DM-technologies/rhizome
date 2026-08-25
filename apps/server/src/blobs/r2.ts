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

  async get(namespace: BlobNamespace, key: string): Promise<StoredBlob | null> {
    try {
      const response = await this.#client.send(
        new GetObjectCommand({ Bucket: this.#buckets[namespace], Key: key }),
      );
      if (!response.Body) return null;
      return {
        bytes: await response.Body.transformToByteArray(),
        contentType: response.ContentType,
      };
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
