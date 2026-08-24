import { validateMediaObject, type MediaObject } from "@rnet/types";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import { contentHash } from "../blobs/content.ts";
import type { BlobStore } from "../blobs/index.ts";
import type { Database, DatabaseTransaction } from "../db/index.ts";
import { GRANT_SCOPE } from "../db/models/grant.ts";
import { dmachines } from "../db/models/dmachine.ts";
import { mediaElements } from "../db/models/media-element.ts";
import { mediaObjectElements } from "../db/models/media-object-element.ts";
import { mediaObjectOrigins } from "../db/models/media-object-origin.ts";
import {
  mediaObjectRevisions,
  type MediaObjectRevisionBlock,
} from "../db/models/media-object-revision.ts";
import {
  mediaObjects,
  type DbMediaObject,
  type NewDbMediaObject,
} from "../db/models/media-object.ts";
import { originArtifacts } from "../db/models/origin-artifact.ts";
import { vibeMediaObjects } from "../db/models/vibe-media-object.ts";
import type { DbVibe } from "../db/models/vibe.ts";
import { grantMissing, notFound, Problem } from "../errors.ts";
import { RNET_SCHEMA_VERSION } from "../rnet.ts";
import type { CreateMediaObjectInput } from "../routes/media-object-contracts.ts";
import { AccessService } from "./access-service.ts";
import {
  MediaElementsService,
  type PendingMediaElementUpload,
  type PreparedMediaElementUpload,
} from "./media-element-service.ts";
import { schemaProblem } from "./problems.ts";
import type { ServiceContext } from "./types.ts";
import { uriId } from "./uris.ts";

type MediaElementReferenceRow = { uuid: string };

interface HashedMediaElementUpload extends PendingMediaElementUpload {
  uuid: string;
  contentHash: string;
}

type MediaObjectBlockSnapshot =
  NonNullable<MediaObject["user"]> | NonNullable<MediaObject["inferred"]>;

interface MediaObjectBlockUpdate<Snapshot extends MediaObjectBlockSnapshot> {
  block: Exclude<MediaObjectRevisionBlock, "source">;
  buildSnapshot(currentMediaObject: DbMediaObject): Snapshot;
  buildCandidate(currentMediaObject: DbMediaObject, snapshot: Snapshot): DbMediaObject;
  persist(
    transaction: DatabaseTransaction,
    currentMediaObject: DbMediaObject,
    snapshot: Snapshot,
  ): Promise<{ mediaObject: DbMediaObject; revision: number }>;
}

export class MediaObjectsService {
  private readonly db: Database;
  private readonly actor: ServiceContext["actor"];
  private readonly access: AccessService;
  private readonly mediaElementsService: MediaElementsService;

  constructor(context: ServiceContext & { blobs?: BlobStore }) {
    this.db = context.db;
    this.actor = context.actor;
    this.access = new AccessService(context);
    this.mediaElementsService = new MediaElementsService(context);
  }

  async findById(uuid: string): Promise<DbMediaObject | undefined> {
    const mediaObject: DbMediaObject | undefined = await this.db.query.mediaObjects.findFirst({
      where: eq(mediaObjects.uuid, uuid),
    });
    return mediaObject;
  }

  async findByIds(uuids: string[]): Promise<DbMediaObject[]> {
    if (!uuids.length) return [];
    const matchingMediaObjects: DbMediaObject[] = await this.db.query.mediaObjects.findMany({
      where: inArray(mediaObjects.uuid, uuids),
    });
    return matchingMediaObjects;
  }

  async getMediaObject(uuid: string): Promise<{ document: MediaObject; userRev: number }> {
    const mediaObjectRecord = await this.findById(uuid);
    if (!mediaObjectRecord) throw notFound("Object");
    if (!(await this.access.canReadMediaObject(uuid))) throw grantMissing(GRANT_SCOPE.READ);
    return {
      document: await this.toDocument(mediaObjectRecord),
      userRev: mediaObjectRecord.userRev,
    };
  }

  async createMediaObjects(
    vibe: string | undefined,
    mediaObjectInputs: CreateMediaObjectInput[],
    pendingMediaElementUploads: ReadonlyMap<string, PendingMediaElementUpload> = new Map(),
  ): Promise<MediaObject[]> {
    const vibeUuid = vibe ? uriId(vibe) : undefined;
    let targetVibe: DbVibe | undefined;
    if (this.actor.kind === "client") {
      if (!vibeUuid)
        throw schemaProblem([{ instancePath: "/vibe", message: "is required for clients" }]);
      targetVibe = await this.access.assertVibeScope(vibeUuid, GRANT_SCOPE.WRITE_OBJECTS);
    } else if (vibeUuid) {
      targetVibe = await this.access.assertVibeScope(vibeUuid, GRANT_SCOPE.WRITE_OBJECTS);
    }
    const ownerUuid =
      targetVibe?.ownerUuid ?? (this.actor.kind === "user" ? this.actor.uuid : undefined);
    if (!ownerUuid) throw grantMissing("owner");
    const hashedMediaElementUploads = await this.hashMediaElementUploads(
      pendingMediaElementUploads,
    );
    const preparedMediaElementUploads = this.prepareMediaElementUploads({
      mediaObjectInputs,
      hashedMediaElementUploads,
    });
    const mediaObjectDocuments = mediaObjectInputs.map((input, index) =>
      this.buildMediaObjectDocument({
        ownerUuid,
        input,
        index,
        preparedMediaElementUploads,
      }),
    );
    const uploadedMediaElementUuids = new Set(
      [...preparedMediaElementUploads.values()].map(({ uuid }) => uuid),
    );

    return this.db.transaction(async (transaction: DatabaseTransaction) => {
      const createdMediaObjects: MediaObject[] = [];
      if (vibeUuid) {
        await this.access.assertTransactionalVibeScope({
          transaction,
          vibeUuid,
          expectedOwnerUuid: ownerUuid,
          scope: GRANT_SCOPE.WRITE_OBJECTS,
        });
      } else {
        await this.access.assertRecordOwner(ownerUuid);
      }
      for (const mediaObjectDocument of mediaObjectDocuments) {
        await this.assertMediaObjectReferences(
          transaction,
          mediaObjectDocument,
          uploadedMediaElementUuids,
        );
      }
      for (const [name, mediaElementUpload] of preparedMediaElementUploads) {
        await this.mediaElementsService.createMediaElement({
          ownerUuid,
          mediaElementUpload,
          transaction,
          validationPath: `/uploads/${name}`,
        });
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
        const mediaObjectOwnerUuid = uriId(mediaObjectDocument.owner);
        const extensions = Object.fromEntries(
          Object.entries(mediaObjectDocument).filter(([key]) => key.startsWith("x-")),
        );
        const newMediaObject: NewDbMediaObject = {
          uuid: mediaObjectUuid,
          ownerUuid: mediaObjectOwnerUuid,
          createdBy: this.actor.subject,
          type: mediaObjectDocument.type,
          keys: mediaObjectDocument.keys ?? {},
          source: mediaObjectDocument.source,
          user: mediaObjectDocument.user,
          inferred: mediaObjectDocument.inferred ?? {},
          extensions,
          rnetSchema: mediaObjectDocument.rnet_schema,
        };
        await transaction.insert(mediaObjects).values(newMediaObject);
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
    await this.access.assertMediaObjectScope(mediaObjectUuid, GRANT_SCOPE.WRITE_USER);
    const updatedMediaObject = await this.updateMediaObjectBlock(mediaObjectUuid, {
      block: "user",
      buildSnapshot: () => ({
        properties,
        updated_at: new Date().toISOString(),
      }),
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
    await this.access.assertMediaObjectScope(mediaObjectUuid, GRANT_SCOPE.WRITE_INFERRED);
    if (task.includes(":")) {
      throw new Problem(
        403,
        "writer_namespace_mismatch",
        "Writer namespace mismatch",
        "Pass a bare task name",
      );
    }
    if (this.actor.kind === "public") throw grantMissing(GRANT_SCOPE.WRITE_INFERRED);
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
      const mediaElementReferences: MediaElementReferenceRow[] = await transaction
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
      const validatedSnapshot = validation.value[update.block] as Snapshot | undefined;
      if (!validatedSnapshot) throw new Error(`Validated object is missing ${update.block}`);

      const persisted = await update.persist(transaction, currentMediaObject, validatedSnapshot);
      await transaction.insert(mediaObjectRevisions).values({
        mediaObjectUuid,
        block: update.block,
        rev: persisted.revision,
        snapshot: validatedSnapshot,
        actor: this.actor.subject,
      });
      return persisted.mediaObject;
    });
  }

  async toDocument(mediaObjectRecord: DbMediaObject): Promise<MediaObject> {
    const mediaElementReferences: MediaElementReferenceRow[] = await this.db
      .select({ uuid: mediaObjectElements.mediaElementUuid })
      .from(mediaObjectElements)
      .where(eq(mediaObjectElements.mediaObjectUuid, mediaObjectRecord.uuid))
      .orderBy(asc(mediaObjectElements.position));
    return this.toDocumentFromMediaElementUuids(
      mediaObjectRecord,
      mediaElementReferences.map((reference) => reference.uuid),
    );
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

  private prepareMediaElementUploads({
    mediaObjectInputs,
    hashedMediaElementUploads,
  }: {
    mediaObjectInputs: CreateMediaObjectInput[];
    hashedMediaElementUploads: ReadonlyMap<string, HashedMediaElementUpload>;
  }): Map<string, PreparedMediaElementUpload> {
    const preparedMediaElementUploads = new Map<string, PreparedMediaElementUpload>();

    for (const [mediaObjectIndex, mediaObjectInput] of mediaObjectInputs.entries()) {
      for (const [mediaElementIndex, mediaElementReference] of (
        mediaObjectInput.elements ?? []
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
    return preparedMediaElementUploads;
  }

  private buildMediaObjectDocument({
    ownerUuid,
    input,
    index,
    preparedMediaElementUploads,
  }: {
    ownerUuid: string;
    input: CreateMediaObjectInput;
    index: number;
    preparedMediaElementUploads: ReadonlyMap<string, PreparedMediaElementUpload>;
  }): MediaObject {
    const mediaObjectUuid = uuidv7();
    const owner = `rnet://id/${ownerUuid}`;
    const elements = this.resolveMediaElementReferences({
      input: input.elements,
      mediaObjectIndex: index,
      preparedMediaElementUploads,
    });
    const extensions = Object.fromEntries(
      Object.entries(input).filter(([key]) => key.startsWith("x-")),
    );
    const candidateMediaObject = {
      ...(this.actor.kind === "client"
        ? {
            type: input.type,
            ...(input.keys === undefined ? {} : { keys: input.keys }),
            ...extensions,
          }
        : input),
      rnet_schema: RNET_SCHEMA_VERSION,
      uri: `rnet://object/${mediaObjectUuid}`,
      owner,
      elements,
      source:
        this.actor.kind === "client"
          ? {
              ingest: { method: "authored", reproducible: false },
              origins: [`rnet://client/${this.actor.uuid}`],
              properties: "properties" in input ? (input.properties ?? {}) : {},
            }
          : "source" in input
            ? input.source
            : undefined,
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

  private resolveMediaElementReferences({
    input,
    mediaObjectIndex,
    preparedMediaElementUploads,
  }: {
    input: CreateMediaObjectInput["elements"];
    mediaObjectIndex: number;
    preparedMediaElementUploads: ReadonlyMap<string, PreparedMediaElementUpload>;
  }): string[] {
    if (input === undefined) return [];
    return input.map((element, elementIndex) => {
      if (typeof element === "string") return element;
      const pointer = `/objects/${mediaObjectIndex}/elements/${elementIndex}`;
      const preparedMediaElementUpload = preparedMediaElementUploads.get(element.upload);
      if (!preparedMediaElementUpload) {
        throw new Error(`Media element upload ${element.upload} was not prepared at ${pointer}`);
      }
      return `rnet://element/${preparedMediaElementUpload.uuid}`;
    });
  }

  private async assertMediaObjectReferences(
    transaction: DatabaseTransaction,
    mediaObjectDocument: MediaObject,
    uploadedElementUuids: ReadonlySet<string>,
  ): Promise<void> {
    const ownerUuid = uriId(mediaObjectDocument.owner);
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
        throw grantMissing(GRANT_SCOPE.WRITE_OBJECTS);
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
