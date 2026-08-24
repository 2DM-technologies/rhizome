import { validateSchema, type MediaElement } from "@rnet/types";
import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import { contentHash } from "../blobs/content.ts";
import type { BlobStore } from "../blobs/index.ts";
import type { Database, DatabaseTransaction } from "../db/index.ts";
import { GRANT_SCOPE } from "../db/models/grant.ts";
import {
  mediaElements,
  type DbMediaElement,
  type MediaElementKind,
  type NewDbMediaElement,
} from "../db/models/media-element.ts";
import { grantMissing, notFound } from "../errors.ts";
import { RNET_SCHEMA_VERSION } from "../rnet.ts";
import type { CreateMediaObjectInput } from "../routes/media-object-contracts.ts";
import { AccessService } from "./access-service.ts";
import { schemaProblem } from "./problems.ts";
import type { ServiceContext } from "./types.ts";
import { uriId } from "./uris.ts";

export interface PendingMediaElementUpload {
  bytes: Uint8Array;
  mime?: string;
}

export interface CreateMediaElementUpload extends PendingMediaElementUpload {
  uuid?: string;
  contentHash?: string;
  kind?: string;
}

interface PreparedMediaElementUpload extends CreateMediaElementUpload {
  uuid: string;
  contentHash: string;
  kind: MediaElement["kind"];
  mime: string;
}

interface HashedMediaElementUpload extends PendingMediaElementUpload {
  uuid: string;
  contentHash: string;
}

export interface CreateMediaElementInput {
  ownerUuid: string;
  mediaElementUpload: CreateMediaElementUpload;
  transaction?: DatabaseTransaction;
  validationPath?: string;
}

export class MediaElementsService {
  private readonly db: Database;
  private readonly access: AccessService;
  private readonly actor: ServiceContext["actor"];
  private readonly blobs?: BlobStore;

  constructor(context: ServiceContext & { blobs?: BlobStore }) {
    this.db = context.db;
    this.access = new AccessService(context);
    this.actor = context.actor;
    this.blobs = context.blobs;
  }

  async prepareMediaElementUploads({
    mediaElementReferencesByObject,
    pendingMediaElementUploads,
  }: {
    mediaElementReferencesByObject: CreateMediaObjectInput["elements"][];
    pendingMediaElementUploads: ReadonlyMap<string, PendingMediaElementUpload>;
  }): Promise<{
    uploads: Map<string, PreparedMediaElementUpload>;
    mediaElementUrisByObject: string[][];
  }> {
    const hashedMediaElementUploads = await this.hashMediaElementUploads(
      pendingMediaElementUploads,
    );
    const preparedMediaElementUploads = new Map<string, PreparedMediaElementUpload>();

    for (const [
      mediaObjectIndex,
      mediaElementReferences,
    ] of mediaElementReferencesByObject.entries()) {
      for (const [mediaElementIndex, mediaElementReference] of (
        mediaElementReferences ?? []
      ).entries()) {
        if (typeof mediaElementReference === "string") continue;
        const pointer = `/objects/${mediaObjectIndex}/elements/${mediaElementIndex}`;
        const mime = mediaElementReference.mime.split(";", 1)[0]?.trim();
        if (!mime) {
          throw schemaProblem([{ instancePath: `${pointer}/mime`, message: "must not be empty" }]);
        }
        const hashedMediaElementUpload = hashedMediaElementUploads.get(
          mediaElementReference.upload,
        );
        if (!hashedMediaElementUpload) {
          throw schemaProblem([
            {
              instancePath: `${pointer}/upload`,
              message: `has no file part named ${mediaElementReference.upload}`,
            },
          ]);
        }
        const preparedMediaElementUpload = preparedMediaElementUploads.get(
          mediaElementReference.upload,
        );
        if (
          preparedMediaElementUpload &&
          preparedMediaElementUpload.kind !== mediaElementReference.kind
        ) {
          throw schemaProblem([
            { instancePath: `${pointer}/kind`, message: "conflicts with another reference" },
          ]);
        }
        const existingMime = preparedMediaElementUpload?.mime ?? hashedMediaElementUpload.mime;
        if (existingMime && existingMime !== mime) {
          throw schemaProblem([
            {
              instancePath: `${pointer}/mime`,
              message: "conflicts with the file part or another reference",
            },
          ]);
        }
        if (!preparedMediaElementUpload) {
          preparedMediaElementUploads.set(mediaElementReference.upload, {
            ...hashedMediaElementUpload,
            kind: mediaElementReference.kind,
            mime,
          });
        }
      }
    }

    const unreferencedMediaElementUpload = [...hashedMediaElementUploads.keys()].find(
      (name) => !preparedMediaElementUploads.has(name),
    );
    if (unreferencedMediaElementUpload) {
      throw schemaProblem([
        {
          instancePath: `/uploads/${unreferencedMediaElementUpload}`,
          message: "is not referenced by an object",
        },
      ]);
    }
    const mediaElementUrisByObject = mediaElementReferencesByObject.map(
      (mediaElementReferences, mediaObjectIndex) =>
        this.resolveMediaElementReferences({
          mediaElementReferences,
          mediaObjectIndex,
          preparedMediaElementUploads,
        }),
    );
    return { uploads: preparedMediaElementUploads, mediaElementUrisByObject };
  }

  async createMediaElement({
    ownerUuid,
    mediaElementUpload,
    transaction,
    validationPath,
  }: CreateMediaElementInput): Promise<MediaElement> {
    if (!this.blobs) throw new Error("Blob storage is required to create a media element");
    const mediaElementUuid = mediaElementUpload.uuid ?? uuidv7();
    const contentHashValue =
      mediaElementUpload.contentHash ?? (await contentHash(mediaElementUpload.bytes));
    const candidateMediaElement = {
      rnet_schema: RNET_SCHEMA_VERSION,
      uri: `rnet://element/${mediaElementUuid}`,
      owner: `rnet://id/${ownerUuid}`,
      content_hash: contentHashValue,
      kind: mediaElementUpload.kind,
      mime: mediaElementUpload.mime,
      bytes: await this.blobs.signedUrl("elements", contentHashValue),
      byte_size: mediaElementUpload.bytes.byteLength,
      created_at: new Date().toISOString(),
    };
    const validation = validateSchema("media-element", candidateMediaElement);
    if (!validation.ok) throw schemaProblem(validation.issues, validationPath);
    const mediaElement = {
      ...validation.value,
      byte_size: candidateMediaElement.byte_size,
      created_at: candidateMediaElement.created_at,
    } satisfies MediaElement;
    await this.blobs.put(
      "elements",
      mediaElement.content_hash,
      mediaElementUpload.bytes,
      mediaElement.mime,
    );

    const database = transaction ?? this.db;
    const newMediaElement: NewDbMediaElement = {
      uuid: uriId(mediaElement.uri),
      ownerUuid: uriId(mediaElement.owner),
      contentHash: mediaElement.content_hash,
      kind: mediaElement.kind as MediaElementKind,
      mime: mediaElement.mime,
      byteSize: mediaElement.byte_size,
      rnetSchema: mediaElement.rnet_schema,
      createdAt: new Date(mediaElement.created_at),
      createdBy: this.actor.subject,
    };
    const [mediaElementRecord] = await database
      .insert(mediaElements)
      .values(newMediaElement)
      .returning();
    if (!mediaElementRecord) throw new Error("Media element metadata was not stored");
    return mediaElement;
  }

  async getMediaElement(uuid: string): Promise<DbMediaElement> {
    if (!(await this.access.canReadMediaElement(uuid))) throw grantMissing(GRANT_SCOPE.READ);
    const [mediaElementRecord] = await this.db
      .select()
      .from(mediaElements)
      .where(eq(mediaElements.uuid, uuid));
    if (!mediaElementRecord || mediaElementRecord.tombstonedAt) throw notFound("Element");
    return mediaElementRecord;
  }

  private async hashMediaElementUploads(
    pendingMediaElementUploads: ReadonlyMap<string, PendingMediaElementUpload>,
  ): Promise<Map<string, HashedMediaElementUpload>> {
    return new Map(
      await Promise.all(
        [...pendingMediaElementUploads].map(
          async ([name, upload]) =>
            [
              name,
              {
                ...upload,
                uuid: uuidv7(),
                contentHash: await contentHash(upload.bytes),
              },
            ] as const,
        ),
      ),
    );
  }

  private resolveMediaElementReferences({
    mediaElementReferences,
    mediaObjectIndex,
    preparedMediaElementUploads,
  }: {
    mediaElementReferences: CreateMediaObjectInput["elements"];
    mediaObjectIndex: number;
    preparedMediaElementUploads: ReadonlyMap<string, PreparedMediaElementUpload>;
  }): string[] {
    if (mediaElementReferences === undefined) return [];
    return mediaElementReferences.map((mediaElementReference, mediaElementIndex) => {
      if (typeof mediaElementReference === "string") return mediaElementReference;
      const pointer = `/objects/${mediaObjectIndex}/elements/${mediaElementIndex}`;
      const preparedMediaElementUpload = preparedMediaElementUploads.get(
        mediaElementReference.upload,
      );
      if (!preparedMediaElementUpload) {
        throw new Error(
          `Media element upload ${mediaElementReference.upload} was not prepared at ${pointer}`,
        );
      }
      return `rnet://element/${preparedMediaElementUpload.uuid}`;
    });
  }
}
