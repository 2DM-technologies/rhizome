import {
  RNET_SCHEMA_VERSION,
  validateMediaObject,
  validateSchema,
  type MediaElement,
  type MediaObject,
} from "@rnet/types";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import { contentHash } from "../blobs/content.ts";
import type { BlobStore } from "../blobs/index.ts";
import type { Database, DatabaseTransaction } from "../db/index.ts";
import { grants } from "../db/models/grant.ts";
import { dmachines } from "../db/models/dmachine.ts";
import { mediaElements } from "../db/models/media-element.ts";
import { mediaObjectElements } from "../db/models/media-object-element.ts";
import { mediaObjectOrigins } from "../db/models/media-object-origin.ts";
import { mediaObjectRevisions } from "../db/models/media-object-revision.ts";
import { mediaObjects } from "../db/models/media-object.ts";
import { originArtifacts } from "../db/models/origin-artifact.ts";
import { vibeMediaObjects } from "../db/models/vibe-media-object.ts";
import { vibes } from "../db/models/vibe.ts";
import { grantMissing, notFound, Problem } from "../errors.ts";
import { AccessService, type DbVibe } from "./access.ts";
import { schemaProblem } from "./problems.ts";
import type { ServiceContext } from "./types.ts";
import { uriId } from "./uris.ts";

export type DbMediaObject = typeof mediaObjects.$inferSelect;

export interface PendingMediaElementUpload {
  bytes: Uint8Array;
  mime?: string;
}

interface PreparedMediaElementUpload extends PendingMediaElementUpload {
  uuid: string;
  contentHash: string;
  kind?: string;
}

interface ReadyMediaElementUpload extends PreparedMediaElementUpload {
  kind: MediaElement["kind"];
  mime: string;
}

type MediaObjectBlockSnapshot =
  NonNullable<MediaObject["user"]> | NonNullable<MediaObject["inferred"]>;

interface MediaObjectBlockUpdate<Snapshot extends MediaObjectBlockSnapshot> {
  block: "user" | "inferred";
  buildSnapshot(currentMediaObject: DbMediaObject): Snapshot;
  buildCandidate(currentMediaObject: DbMediaObject, snapshot: Snapshot): DbMediaObject;
  persist(
    transaction: DatabaseTransaction,
    currentMediaObject: DbMediaObject,
    snapshot: Snapshot,
  ): Promise<{ mediaObject: DbMediaObject; revision: number }>;
}

export class MediaObjectService {
  private readonly db: Database;
  private readonly actor: ServiceContext["actor"];
  private readonly access: AccessService;
  private readonly blobs?: BlobStore;

  constructor(context: ServiceContext & { blobs?: BlobStore }) {
    this.db = context.db;
    this.actor = context.actor;
    this.access = new AccessService(context);
    this.blobs = context.blobs;
  }

  async getMediaObject(uuid: string): Promise<{ document: MediaObject; userRev: number }> {
    const [mediaObjectRecord] = await this.db
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.uuid, uuid));
    if (!mediaObjectRecord) throw notFound("Object");
    if (!(await this.access.canReadMediaObject(uuid))) throw grantMissing("read");
    return {
      document: await this.toDocument(mediaObjectRecord),
      userRev: mediaObjectRecord.userRev,
    };
  }

  async createMediaObjects(
    vibe: string | undefined,
    mediaObjectInputs: unknown[],
    pendingUploads: ReadonlyMap<string, PendingMediaElementUpload> = new Map(),
  ): Promise<MediaObject[]> {
    const vibeUuid = vibe ? uriId(vibe) : undefined;
    let targetVibe: DbVibe | undefined;
    if (this.actor.kind === "client") {
      if (!vibeUuid)
        throw schemaProblem([{ instancePath: "/vibe", message: "is required for clients" }]);
      targetVibe = await this.access.assertVibeScope(vibeUuid, "write:objects");
    } else if (vibeUuid) {
      targetVibe = await this.access.assertVibeScope(vibeUuid, "write:objects");
    }
    const ownerUuid =
      targetVibe?.ownerUuid ?? (this.actor.kind === "user" ? this.actor.uuid : undefined);
    if (!ownerUuid) throw grantMissing("owner");
    const preparedUploads = new Map<string, PreparedMediaElementUpload>(
      await Promise.all(
        [...pendingUploads].map(
          async ([name, upload]) =>
            [
              name,
              {
                ...upload,
                uuid: uuidv7(),
                contentHash: await contentHash(upload.bytes),
              } as PreparedMediaElementUpload,
            ] as const,
        ),
      ),
    );

    const mediaObjectDocuments = mediaObjectInputs.map((item, index) =>
      this.normalizeMediaObject(ownerUuid, item, index, preparedUploads),
    );
    const unusedUpload = [...preparedUploads].find(([, upload]) => !upload.kind || !upload.mime);
    if (unusedUpload) {
      throw schemaProblem([
        { instancePath: `/uploads/${unusedUpload[0]}`, message: "is not referenced by an object" },
      ]);
    }
    const uploadedElementUuids = new Set(
      [...preparedUploads.values()].map((upload) => upload.uuid),
    );
    const readyUploads = new Map<string, ReadyMediaElementUpload>();
    if (preparedUploads.size) {
      if (!this.blobs) throw new Error("Blob storage is required for atomic element uploads");
      for (const [name, upload] of preparedUploads) {
        const candidateMediaElement = {
          rnet_schema: RNET_SCHEMA_VERSION,
          uri: `rnet://element/${upload.uuid}`,
          owner: `rnet://id/${ownerUuid}`,
          content_hash: upload.contentHash,
          kind: upload.kind,
          mime: upload.mime,
          bytes: await this.blobs.signedUrl("elements", upload.contentHash),
          byte_size: upload.bytes.byteLength,
          created_at: new Date().toISOString(),
        };
        const validation = validateSchema("media-element", candidateMediaElement);
        if (!validation.ok) throw schemaProblem(validation.issues, `/uploads/${name}`);
        const readyUpload: ReadyMediaElementUpload = {
          ...upload,
          kind: validation.value.kind,
          mime: validation.value.mime,
        };
        readyUploads.set(name, readyUpload);
        await this.blobs.put(
          "elements",
          readyUpload.contentHash,
          readyUpload.bytes,
          readyUpload.mime,
        );
      }
    }

    return this.db.transaction(async (transaction: DatabaseTransaction) => {
      const createdMediaObjects: MediaObject[] = [];
      await this.assertTransactionalWriteAccess(transaction, vibeUuid, ownerUuid);
      for (const mediaObjectDocument of mediaObjectDocuments) {
        await this.assertMediaObjectReferences(
          transaction,
          ownerUuid,
          mediaObjectDocument,
          uploadedElementUuids,
        );
      }
      if (readyUploads.size) {
        await transaction.insert(mediaElements).values(
          [...readyUploads.values()].map((upload) => ({
            uuid: upload.uuid,
            ownerUuid,
            contentHash: upload.contentHash,
            kind: upload.kind,
            mime: upload.mime,
            byteSize: upload.bytes.byteLength,
            rnetSchema: RNET_SCHEMA_VERSION,
            createdBy: this.actor.subject,
          })),
        );
      }
      let nextVibePosition: number | undefined;
      if (vibeUuid) {
        const [maxPosition] = await transaction
          .select({ max: sql<number>`coalesce(max(${vibeMediaObjects.position}), -1)::int` })
          .from(vibeMediaObjects)
          .where(eq(vibeMediaObjects.vibeUuid, vibeUuid));
        nextVibePosition = (maxPosition?.max ?? -1) + 1;
      }
      for (const [mediaObjectIndex, mediaObjectDocument] of mediaObjectDocuments.entries()) {
        const mediaObjectUuid = uriId(mediaObjectDocument.uri);
        const extensions = Object.fromEntries(
          Object.entries(mediaObjectDocument).filter(([key]) => key.startsWith("x-")),
        );
        await transaction.insert(mediaObjects).values({
          uuid: mediaObjectUuid,
          ownerUuid,
          createdBy: this.actor.subject,
          type: mediaObjectDocument.type,
          keys: mediaObjectDocument.keys ?? {},
          source: mediaObjectDocument.source,
          user: mediaObjectDocument.user,
          inferred: mediaObjectDocument.inferred ?? {},
          extensions,
          rnetSchema: mediaObjectDocument.rnet_schema,
        });
        if (mediaObjectDocument.elements.length) {
          await transaction.insert(mediaObjectElements).values(
            mediaObjectDocument.elements.map((uri, position) => ({
              mediaObjectUuid,
              mediaElementUuid: uriId(uri),
              position,
            })),
          );
        }
        await transaction
          .insert(mediaObjectOrigins)
          .values(
            mediaObjectDocument.source.origins.map((uri) =>
              uri.startsWith("rnet://origin/")
                ? { mediaObjectUuid, originArtifactUuid: uriId(uri) }
                : { mediaObjectUuid, dmachineUuid: uriId(uri) },
            ),
          );
        await transaction.insert(mediaObjectRevisions).values({
          mediaObjectUuid,
          block: "source",
          rev: 1,
          snapshot: mediaObjectDocument.source,
          actor: this.actor.subject,
        });
        if (vibeUuid && nextVibePosition !== undefined) {
          await transaction.insert(vibeMediaObjects).values({
            vibeUuid,
            mediaObjectUuid,
            position: nextVibePosition + mediaObjectIndex,
          });
        }
        createdMediaObjects.push(mediaObjectDocument);
      }
      return createdMediaObjects;
    });
  }

  async setUser(
    mediaObjectUuid: string,
    expectedRev: number,
    properties: Record<string, unknown>,
  ): Promise<{ document: MediaObject; userRev: number }> {
    await this.access.assertMediaObjectScope(mediaObjectUuid, "write:user");
    const candidateUser: NonNullable<MediaObject["user"]> = {
      properties,
      updated_at: new Date().toISOString(),
    };
    const updatedMediaObject = await this.updateMediaObjectBlock(mediaObjectUuid, {
      block: "user",
      buildSnapshot: () => candidateUser,
      buildCandidate: (currentMediaObject, user) => ({ ...currentMediaObject, user }),
      persist: async (transaction, currentMediaObject, user) => {
        if (currentMediaObject.userRev !== expectedRev) {
          throw new Problem(
            409,
            "revision_conflict",
            "Revision conflict",
            "The user block changed",
            { expected: expectedRev, current: currentMediaObject.userRev },
          );
        }
        const [nextMediaObject] = await transaction
          .update(mediaObjects)
          .set({ user, userRev: sql`${mediaObjects.userRev} + 1` })
          .where(and(eq(mediaObjects.uuid, mediaObjectUuid), eq(mediaObjects.userRev, expectedRev)))
          .returning();
        if (!nextMediaObject) {
          throw new Problem(
            409,
            "revision_conflict",
            "Revision conflict",
            "The user block changed",
          );
        }
        return { mediaObject: nextMediaObject, revision: nextMediaObject.userRev };
      },
    });
    return {
      document: await this.toDocument(updatedMediaObject),
      userRev: updatedMediaObject.userRev,
    };
  }

  async setInferred(
    mediaObjectUuid: string,
    task: string,
    entry: NonNullable<MediaObject["inferred"]>[string],
  ): Promise<MediaObject> {
    await this.access.assertMediaObjectScope(mediaObjectUuid, "write:inferred");
    if (task.includes(":")) {
      throw new Problem(
        403,
        "writer_namespace_mismatch",
        "Writer namespace mismatch",
        "Pass a bare task name",
      );
    }
    if (this.actor.kind === "public") throw grantMissing("write:inferred");
    if (this.actor.kind === "client" && entry.durable === true) {
      throw schemaProblem([
        {
          instancePath: "/entry/durable",
          message: "cannot be set by reproducible client task output",
        },
      ]);
    }
    const writer = this.actor.kind === "client" ? this.actor.name : `user/${this.actor.uuid}`;
    const key = `${writer}:${task}`;
    const updatedMediaObject = await this.updateMediaObjectBlock(mediaObjectUuid, {
      block: "inferred",
      buildSnapshot: (currentMediaObject) => ({
        ...currentMediaObject.inferred,
        [key]: entry,
      }),
      buildCandidate: (currentMediaObject, inferred) => ({ ...currentMediaObject, inferred }),
      persist: async (transaction, _currentMediaObject, inferred) => {
        const [maxRevision] = await transaction
          .select({ max: sql<number>`coalesce(max(${mediaObjectRevisions.rev}), 0)::int` })
          .from(mediaObjectRevisions)
          .where(
            and(
              eq(mediaObjectRevisions.mediaObjectUuid, mediaObjectUuid),
              eq(mediaObjectRevisions.block, "inferred"),
            ),
          );
        const [nextMediaObject] = await transaction
          .update(mediaObjects)
          .set({ inferred })
          .where(eq(mediaObjects.uuid, mediaObjectUuid))
          .returning();
        if (!nextMediaObject) throw notFound("Object");
        return { mediaObject: nextMediaObject, revision: (maxRevision?.max ?? 0) + 1 };
      },
    });
    return this.toDocument(updatedMediaObject);
  }

  private async updateMediaObjectBlock<Snapshot extends MediaObjectBlockSnapshot>(
    mediaObjectUuid: string,
    update: MediaObjectBlockUpdate<Snapshot>,
  ): Promise<DbMediaObject> {
    return this.db.transaction(async (transaction: DatabaseTransaction) => {
      await transaction.execute(
        sql`SELECT 1 FROM ${mediaObjects} WHERE ${mediaObjects.uuid} = ${mediaObjectUuid}::uuid FOR UPDATE`,
      );
      const [currentMediaObject] = await transaction
        .select()
        .from(mediaObjects)
        .where(eq(mediaObjects.uuid, mediaObjectUuid));
      if (!currentMediaObject) throw notFound("Object");

      const snapshot = update.buildSnapshot(currentMediaObject);
      const mediaElementReferences = await transaction
        .select({ uuid: mediaObjectElements.mediaElementUuid })
        .from(mediaObjectElements)
        .where(eq(mediaObjectElements.mediaObjectUuid, mediaObjectUuid))
        .orderBy(asc(mediaObjectElements.position));
      const candidateMediaObject = this.toDocumentFromMediaElementUuids(
        update.buildCandidate(currentMediaObject, snapshot),
        mediaElementReferences.map((reference) => reference.uuid),
      );
      const validation = validateMediaObject(candidateMediaObject);
      if (!validation.ok) throw schemaProblem(validation.issues);

      const persisted = await update.persist(transaction, currentMediaObject, snapshot);
      await transaction.insert(mediaObjectRevisions).values({
        mediaObjectUuid,
        block: update.block,
        rev: persisted.revision,
        snapshot,
        actor: this.actor.subject,
      });
      return persisted.mediaObject;
    });
  }

  async toDocument(mediaObjectRecord: DbMediaObject): Promise<MediaObject> {
    const mediaElementReferences = await this.db
      .select({ uuid: mediaObjectElements.mediaElementUuid })
      .from(mediaObjectElements)
      .where(eq(mediaObjectElements.mediaObjectUuid, mediaObjectRecord.uuid))
      .orderBy(asc(mediaObjectElements.position));
    return this.toDocumentFromMediaElementUuids(
      mediaObjectRecord,
      mediaElementReferences.map((reference) => reference.uuid),
    );
  }

  private normalizeMediaObject(
    ownerUuid: string,
    input: unknown,
    index: number,
    uploads: Map<string, PreparedMediaElementUpload>,
  ): MediaObject {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw schemaProblem([{ instancePath: `/objects/${index}`, message: "must be an object" }]);
    }
    const rawMediaObject = input as Record<string, unknown>;
    for (const field of ["rnet_schema", "uri", "owner"] as const) {
      if (rawMediaObject[field] !== undefined) {
        throw schemaProblem([
          {
            instancePath: `/objects/${index}/${field}`,
            message: "is assigned by the store and must be omitted",
          },
        ]);
      }
    }
    const mediaObjectUuid = uuidv7();
    const owner = `rnet://id/${ownerUuid}`;
    const elements = this.resolveMediaElementInputs(rawMediaObject.elements, index, uploads);
    const extensions = Object.fromEntries(
      Object.entries(rawMediaObject).filter(([key]) => key.startsWith("x-")),
    );
    const candidateMediaObject =
      this.actor.kind === "client"
        ? {
            rnet_schema: RNET_SCHEMA_VERSION,
            uri: `rnet://object/${mediaObjectUuid}`,
            owner,
            type: rawMediaObject.type,
            elements: elements ?? [],
            ...(rawMediaObject.keys === undefined ? {} : { keys: rawMediaObject.keys }),
            source: {
              ingest: { method: "authored", reproducible: false },
              origins: [`rnet://client/${this.actor.uuid}`],
              properties: rawMediaObject.properties ?? {},
            },
            ...extensions,
          }
        : {
            ...rawMediaObject,
            rnet_schema: RNET_SCHEMA_VERSION,
            uri: `rnet://object/${mediaObjectUuid}`,
            owner,
            elements: elements ?? [],
          };
    const validation = validateMediaObject(candidateMediaObject);
    if (!validation.ok) throw schemaProblem(validation.issues, `/objects/${index}`);
    if (
      validation.value.user !== undefined ||
      Object.keys(validation.value.inferred ?? {}).length
    ) {
      throw schemaProblem([
        { instancePath: `/objects/${index}`, message: "creation cannot write user or inferred" },
      ]);
    }
    const ingest = validation.value.source.ingest;
    const allowedStamp =
      (ingest.method === "parser" && ingest.reproducible === true) ||
      (ingest.method === "authored" && ingest.reproducible === false);
    if (!allowedStamp) {
      throw new Problem(
        422,
        "ingest_nonconformant",
        "Ingest record is not reachable in M1",
        "M1 accepts parser/reproducible or authored/non-reproducible creation stamps",
      );
    }
    return validation.value;
  }

  private resolveMediaElementInputs(
    input: unknown,
    mediaObjectIndex: number,
    uploads: Map<string, PreparedMediaElementUpload>,
  ): unknown[] | undefined {
    if (input === undefined) return undefined;
    if (!Array.isArray(input)) {
      throw schemaProblem([
        { instancePath: `/objects/${mediaObjectIndex}/elements`, message: "must be an array" },
      ]);
    }
    return input.map((element, elementIndex) => {
      if (typeof element === "string") return element;
      const pointer = `/objects/${mediaObjectIndex}/elements/${elementIndex}`;
      if (!element || typeof element !== "object" || Array.isArray(element)) {
        throw schemaProblem([
          { instancePath: pointer, message: "must be an element URI or upload" },
        ]);
      }
      const descriptor = element as Record<string, unknown>;
      if (
        typeof descriptor.upload !== "string" ||
        typeof descriptor.kind !== "string" ||
        typeof descriptor.mime !== "string"
      ) {
        throw schemaProblem([
          { instancePath: pointer, message: "upload references require upload, kind, and mime" },
        ]);
      }
      const descriptorMime = descriptor.mime.split(";", 1)[0]?.trim();
      if (!descriptorMime) {
        throw schemaProblem([{ instancePath: `${pointer}/mime`, message: "must not be empty" }]);
      }
      const extra = Object.keys(descriptor).find(
        (key) => !["upload", "kind", "mime"].includes(key),
      );
      if (extra) {
        throw schemaProblem([{ instancePath: `${pointer}/${extra}`, message: "is not allowed" }]);
      }
      const upload = uploads.get(descriptor.upload);
      if (!upload) {
        throw schemaProblem([
          {
            instancePath: `${pointer}/upload`,
            message: `has no file part named ${descriptor.upload}`,
          },
        ]);
      }
      if (upload.kind && upload.kind !== descriptor.kind) {
        throw schemaProblem([
          { instancePath: `${pointer}/kind`, message: "conflicts with another reference" },
        ]);
      }
      if (upload.mime && upload.mime !== descriptorMime) {
        throw schemaProblem([
          {
            instancePath: `${pointer}/mime`,
            message: "conflicts with the file part or another reference",
          },
        ]);
      }
      upload.kind = descriptor.kind;
      upload.mime = descriptorMime;
      return `rnet://element/${upload.uuid}`;
    });
  }

  private async assertMediaObjectReferences(
    transaction: DatabaseTransaction,
    ownerUuid: string,
    mediaObjectDocument: MediaObject,
    uploadedElementUuids: ReadonlySet<string>,
  ): Promise<void> {
    for (const uri of mediaObjectDocument.elements) {
      const mediaElementUuid = uriId(uri);
      if (uploadedElementUuids.has(mediaElementUuid)) continue;
      const [mediaElementRecord] = await transaction
        .select({
          uuid: mediaElements.uuid,
          ownerUuid: mediaElements.ownerUuid,
        })
        .from(mediaElements)
        .where(and(eq(mediaElements.uuid, mediaElementUuid), isNull(mediaElements.tombstonedAt)))
        .for("share");
      if (!mediaElementRecord) {
        throw schemaProblem([{ instancePath: "/elements", message: `unknown element ${uri}` }]);
      }
      if (mediaElementRecord.ownerUuid !== ownerUuid) throw grantMissing("owner");
      if (this.actor.kind !== "user" || this.actor.uuid !== ownerUuid) {
        throw grantMissing("write:objects");
      }
    }
    for (const uri of mediaObjectDocument.source.origins) {
      if (uri.startsWith("rnet://origin/")) {
        const [originArtifact] = await transaction
          .select({ uuid: originArtifacts.uuid, ownerUuid: originArtifacts.ownerUuid })
          .from(originArtifacts)
          .where(and(eq(originArtifacts.uuid, uriId(uri)), isNull(originArtifacts.tombstonedAt)))
          .for("share");
        if (!originArtifact) {
          throw schemaProblem([
            { instancePath: "/source/origins", message: `unknown origin ${uri}` },
          ]);
        }
        if (originArtifact.ownerUuid !== ownerUuid) throw grantMissing("owner");
      } else {
        const [dmachine] = await transaction
          .select({ uuid: dmachines.uuid })
          .from(dmachines)
          .where(eq(dmachines.uuid, uriId(uri)))
          .for("share");
        if (!dmachine) {
          throw schemaProblem([
            { instancePath: "/source/origins", message: `unknown client ${uri}` },
          ]);
        }
      }
    }
  }

  private async assertTransactionalWriteAccess(
    transaction: DatabaseTransaction,
    vibeUuid: string | undefined,
    ownerUuid: string,
  ): Promise<void> {
    if (!vibeUuid) {
      if (this.actor.kind !== "user" || this.actor.uuid !== ownerUuid) throw grantMissing("owner");
      return;
    }
    const [vibe] = await transaction
      .select()
      .from(vibes)
      .where(eq(vibes.uuid, vibeUuid))
      .for("update");
    if (!vibe) throw notFound("Vibe");
    if (vibe.ownerUuid !== ownerUuid) throw grantMissing("owner");
    if (this.actor.kind === "user" && this.actor.uuid === ownerUuid) return;
    const [grant] = await transaction
      .select({ scopes: grants.scopes })
      .from(grants)
      .where(
        and(
          eq(grants.vibeUuid, vibeUuid),
          eq(grants.subject, this.actor.subject),
          isNull(grants.revokedAt),
        ),
      )
      .for("share");
    if (!grant?.scopes.includes("write:objects")) throw grantMissing("write:objects");
  }

  private toDocumentFromMediaElementUuids(
    mediaObjectRecord: DbMediaObject,
    mediaElementUuids: string[],
  ): MediaObject {
    return {
      rnet_schema: RNET_SCHEMA_VERSION,
      uri: `rnet://object/${mediaObjectRecord.uuid}`,
      owner: `rnet://id/${mediaObjectRecord.ownerUuid}`,
      type: mediaObjectRecord.type,
      elements: mediaElementUuids.map((uuid) => `rnet://element/${uuid}`),
      ...(Object.keys(mediaObjectRecord.keys).length ? { keys: mediaObjectRecord.keys } : {}),
      source: mediaObjectRecord.source,
      ...(mediaObjectRecord.user ? { user: mediaObjectRecord.user } : {}),
      ...(Object.keys(mediaObjectRecord.inferred).length
        ? { inferred: mediaObjectRecord.inferred }
        : {}),
      ...mediaObjectRecord.extensions,
    } as MediaObject;
  }
}
