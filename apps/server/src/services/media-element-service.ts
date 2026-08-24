import { validateSchema, type MediaElement } from "@rnet/types";
import { and, eq, isNull } from "drizzle-orm";
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

interface CreatedMediaElementUpload {
  uuid: string;
  kind: MediaElement["kind"];
  mime: string;
}

export interface MediaElementUploadContext {
  pendingMediaElementUploads: ReadonlyMap<string, PendingMediaElementUpload>;
  createdMediaElementUploads: Map<string, CreatedMediaElementUpload>;
  referencedUploadNames: Set<string>;
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

  createUploadContext(
    pendingMediaElementUploads: ReadonlyMap<string, PendingMediaElementUpload>,
  ): MediaElementUploadContext {
    return {
      pendingMediaElementUploads,
      createdMediaElementUploads: new Map(),
      referencedUploadNames: new Set(),
    };
  }

  async createMediaElements({
    ownerUuid,
    mediaElementReferences,
    mediaElementUploads,
    transaction,
    validationPath,
  }: {
    ownerUuid: string;
    mediaElementReferences: CreateMediaObjectInput["elements"];
    mediaElementUploads: MediaElementUploadContext;
    transaction: DatabaseTransaction;
    validationPath: string;
  }): Promise<string[]> {
    const mediaElementUuids: string[] = [];

    for (const [index, mediaElementReference] of (mediaElementReferences ?? []).entries()) {
      const pointer = `${validationPath}/${index}`;
      if (typeof mediaElementReference === "string") {
        const mediaElementUuid = uriId(mediaElementReference);
        const [mediaElementRecord] = await transaction
          .select({ uuid: mediaElements.uuid, ownerUuid: mediaElements.ownerUuid })
          .from(mediaElements)
          .where(and(eq(mediaElements.uuid, mediaElementUuid), isNull(mediaElements.tombstonedAt)))
          .for("share");
        if (!mediaElementRecord) {
          throw schemaProblem([
            { instancePath: pointer, message: `unknown element ${mediaElementReference}` },
          ]);
        }
        if (mediaElementRecord.ownerUuid !== ownerUuid) throw grantMissing("owner");
        if (this.actor.kind !== "user" || this.actor.uuid !== ownerUuid) {
          throw grantMissing(GRANT_SCOPE.WRITE_OBJECTS);
        }
        mediaElementUuids.push(mediaElementRecord.uuid);
        continue;
      }

      const upload = mediaElementUploads.pendingMediaElementUploads.get(
        mediaElementReference.upload,
      );
      if (!upload) {
        throw schemaProblem([
          {
            instancePath: `${pointer}/upload`,
            message: `has no file part named ${mediaElementReference.upload}`,
          },
        ]);
      }
      mediaElementUploads.referencedUploadNames.add(mediaElementReference.upload);

      const mime = mediaElementReference.mime.split(";", 1)[0]?.trim();
      if (!mime) {
        throw schemaProblem([{ instancePath: `${pointer}/mime`, message: "must not be empty" }]);
      }
      const createdMediaElementUpload = mediaElementUploads.createdMediaElementUploads.get(
        mediaElementReference.upload,
      );
      if (
        createdMediaElementUpload &&
        createdMediaElementUpload.kind !== mediaElementReference.kind
      ) {
        throw schemaProblem([
          { instancePath: `${pointer}/kind`, message: "conflicts with another reference" },
        ]);
      }
      const existingMime = createdMediaElementUpload?.mime ?? upload.mime;
      if (existingMime && existingMime !== mime) {
        throw schemaProblem([
          {
            instancePath: `${pointer}/mime`,
            message: "conflicts with the file part or another reference",
          },
        ]);
      }
      if (createdMediaElementUpload) {
        mediaElementUuids.push(createdMediaElementUpload.uuid);
        continue;
      }

      const mediaElement = await this.createMediaElement({
        ownerUuid,
        mediaElementUpload: {
          ...upload,
          kind: mediaElementReference.kind,
          mime,
        },
        transaction,
        validationPath: pointer,
      });
      const mediaElementUuid = uriId(mediaElement.uri);
      mediaElementUploads.createdMediaElementUploads.set(mediaElementReference.upload, {
        uuid: mediaElementUuid,
        kind: mediaElement.kind,
        mime: mediaElement.mime,
      });
      mediaElementUuids.push(mediaElementUuid);
    }

    return mediaElementUuids;
  }

  assertAllUploadsUsed(mediaElementUploads: MediaElementUploadContext): void {
    const unreferencedUploadName = [...mediaElementUploads.pendingMediaElementUploads.keys()].find(
      (name) => !mediaElementUploads.referencedUploadNames.has(name),
    );
    if (!unreferencedUploadName) return;
    throw schemaProblem([
      {
        instancePath: `/uploads/${unreferencedUploadName}`,
        message: "is not referenced by an object",
      },
    ]);
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
    const createdAt = new Date();
    const candidateMediaElement = {
      rnet_schema: RNET_SCHEMA_VERSION,
      uri: `rnet://element/${mediaElementUuid}`,
      owner: `rnet://id/${ownerUuid}`,
      content_hash: contentHashValue,
      kind: mediaElementUpload.kind,
      mime: mediaElementUpload.mime,
      bytes: await this.blobs.signedUrl("elements", contentHashValue),
      byte_size: mediaElementUpload.bytes.byteLength,
      created_at: createdAt.toISOString(),
    };
    const validation = validateSchema("media-element", candidateMediaElement);
    if (!validation.ok) throw schemaProblem(validation.issues, validationPath);
    const mediaElement = {
      ...candidateMediaElement,
      rnet_schema: validation.value.rnet_schema,
      kind: validation.value.kind,
      mime: validation.value.mime,
    } satisfies MediaElement;
    await this.blobs.put(
      "elements",
      mediaElement.content_hash,
      mediaElementUpload.bytes,
      mediaElement.mime,
    );

    const database = transaction ?? this.db;
    const newMediaElement: NewDbMediaElement = {
      uuid: mediaElementUuid,
      ownerUuid,
      contentHash: contentHashValue,
      kind: mediaElement.kind as MediaElementKind,
      mime: mediaElement.mime,
      byteSize: mediaElementUpload.bytes.byteLength,
      rnetSchema: RNET_SCHEMA_VERSION,
      createdAt,
      createdBy: this.actor.subject,
    };
    await database.insert(mediaElements).values(newMediaElement);
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
}
