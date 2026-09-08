import type { CreateMediaObjectInput } from "@rhizome/store-contract";
import type { MediaObjectElementRef } from "@rnet/types";
import { and, eq, inArray, isNull } from "drizzle-orm";
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
import { AccessService } from "./access-service.ts";
import { schemaProblem } from "./problems.ts";
import type { ServiceContext } from "./types.ts";
import { uriId } from "./uris.ts";

export interface PendingMediaElementUpload {
  bytes: Uint8Array;
  mime?: string;
}

export interface CreateMediaElementUpload {
  bytes: Uint8Array;
  mime: string;
  kind: MediaElementKind;
  uuid?: string;
  contentHash?: string;
}

interface CreatedMediaElementUpload {
  uuid: string;
  kind: MediaElementKind;
  mime: string;
}

export interface CreatedMediaObjectElementReference {
  uuid: string;
  role?: NonNullable<MediaObjectElementRef["role"]>;
  alt?: string;
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

  async findById(uuid: string): Promise<DbMediaElement | undefined> {
    return this.db.query.mediaElements.findFirst({
      where: eq(mediaElements.uuid, uuid),
    });
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
  }): Promise<CreatedMediaObjectElementReference[]> {
    const createdReferences: CreatedMediaObjectElementReference[] = [];
    const references = mediaElementReferences ?? [];
    const existingMediaElementUuids = references
      .filter(isExistingMediaElementReference)
      .map(({ uri }) => uriId(uri));
    const existingMediaElementRecords: Pick<DbMediaElement, "uuid" | "ownerUuid">[] =
      existingMediaElementUuids.length
        ? await transaction
            .select({ uuid: mediaElements.uuid, ownerUuid: mediaElements.ownerUuid })
            .from(mediaElements)
            .where(
              and(
                inArray(mediaElements.uuid, existingMediaElementUuids),
                isNull(mediaElements.tombstonedAt),
              ),
            )
            .for("share")
        : [];
    const existingMediaElementsByUuid = new Map(
      existingMediaElementRecords.map((mediaElement) => [mediaElement.uuid, mediaElement]),
    );

    for (const [index, mediaElementReference] of references.entries()) {
      const pointer = `${validationPath}/${index}`;
      if (isExistingMediaElementReference(mediaElementReference)) {
        const mediaElementUuid = uriId(mediaElementReference.uri);
        const mediaElementRecord = existingMediaElementsByUuid.get(mediaElementUuid);
        if (!mediaElementRecord) {
          throw schemaProblem([
            {
              instancePath: `${pointer}/uri`,
              message: `unknown element ${mediaElementReference.uri}`,
            },
          ]);
        }
        if (mediaElementRecord.ownerUuid !== ownerUuid) throw grantMissing("owner");
        if (this.actor.kind !== "user" || this.actor.uuid !== ownerUuid) {
          throw grantMissing(GRANT_SCOPE.WRITE_OBJECTS);
        }
        createdReferences.push({
          uuid: mediaElementRecord.uuid,
          ...(mediaElementReference.role ? { role: mediaElementReference.role } : {}),
          ...(mediaElementReference.alt !== undefined ? { alt: mediaElementReference.alt } : {}),
        });
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
        createdReferences.push({
          uuid: createdMediaElementUpload.uuid,
          ...(mediaElementReference.role ? { role: mediaElementReference.role } : {}),
          ...(mediaElementReference.alt !== undefined ? { alt: mediaElementReference.alt } : {}),
        });
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
      });
      mediaElementUploads.createdMediaElementUploads.set(mediaElementReference.upload, {
        uuid: mediaElement.uuid,
        kind: mediaElement.kind,
        mime: mediaElement.mime,
      });
      createdReferences.push({
        uuid: mediaElement.uuid,
        ...(mediaElementReference.role ? { role: mediaElementReference.role } : {}),
        ...(mediaElementReference.alt !== undefined ? { alt: mediaElementReference.alt } : {}),
      });
    }

    return createdReferences;
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
  }: CreateMediaElementInput): Promise<DbMediaElement> {
    if (!this.blobs) throw new Error("Blob storage is required to create a media element");
    const mediaElementUuid = mediaElementUpload.uuid ?? uuidv7();
    const contentHashValue =
      mediaElementUpload.contentHash ?? (await contentHash(mediaElementUpload.bytes));
    const createdAt = new Date();
    await this.blobs.put(
      "elements",
      contentHashValue,
      mediaElementUpload.bytes,
      mediaElementUpload.mime,
    );

    const database = transaction ?? this.db;
    const newMediaElement: NewDbMediaElement = {
      uuid: mediaElementUuid,
      ownerUuid,
      contentHash: contentHashValue,
      kind: mediaElementUpload.kind,
      mime: mediaElementUpload.mime,
      byteSize: mediaElementUpload.bytes.byteLength,
      rnetSchema: RNET_SCHEMA_VERSION,
      createdAt,
      createdBy: this.actor.subject,
    };
    const [mediaElement] = await database.insert(mediaElements).values(newMediaElement).returning();
    if (!mediaElement) throw new Error("Media element insert did not return a row");
    return mediaElement;
  }

  async getMediaElement(uuid: string): Promise<DbMediaElement> {
    if (!(await this.access.canReadMediaElement(uuid))) throw grantMissing(GRANT_SCOPE.READ);
    const mediaElementRecord = await this.findById(uuid);
    if (!mediaElementRecord || mediaElementRecord.tombstonedAt) throw notFound("Element");
    return mediaElementRecord;
  }

  async deleteMediaElement(uuid: string): Promise<void> {
    const mediaElement = await this.findById(uuid);
    if (!mediaElement || mediaElement.tombstonedAt) throw notFound("Element");
    await this.access.assertRecordOwner(mediaElement.ownerUuid);
    const [tombstonedMediaElement] = await this.db
      .update(mediaElements)
      .set({ tombstonedAt: new Date() })
      .where(and(eq(mediaElements.uuid, uuid), isNull(mediaElements.tombstonedAt)))
      .returning({ uuid: mediaElements.uuid });
    if (!tombstonedMediaElement) throw notFound("Element");
  }
}

type MediaElementReferenceInput = NonNullable<CreateMediaObjectInput["elements"]>[number];

function isExistingMediaElementReference(
  value: MediaElementReferenceInput,
): value is MediaObjectElementRef {
  return "uri" in value;
}
