import type { MediaObject } from "@rnet/types";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { BlobStore } from "../blobs/index.ts";
import type { Database, DatabaseTransaction } from "../db/index.ts";
import { GRANT_SCOPE, type GrantScope } from "../db/models/grant.ts";
import { dmachines } from "../db/models/dmachine.ts";
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
import type { MediaObjectAggregate } from "../serializers/media-object-serializer.ts";
import { AccessService } from "./access-service.ts";
import { MediaElementsService, type PendingMediaElementUpload } from "./media-element-service.ts";
import { schemaProblem } from "./problems.ts";
import type { ServiceContext } from "./types.ts";
import { uriId } from "./uris.ts";

type MediaElementReferenceRow = { uuid: string };

type MediaObjectBlockSnapshot =
  NonNullable<MediaObject["user"]> | NonNullable<MediaObject["inferred"]>;

interface MediaObjectBlockUpdate<Snapshot extends MediaObjectBlockSnapshot> {
  block: Exclude<MediaObjectRevisionBlock, "source">;
  buildSnapshot(currentMediaObject: DbMediaObject): Snapshot;
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

  async getMediaObject(
    uuid: string,
  ): Promise<{ mediaObject: MediaObjectAggregate; userRev: number }> {
    const mediaObjectRecord = await this.findById(uuid);
    if (!mediaObjectRecord) throw notFound("Object");
    await this.access.assertMediaObjectScope(mediaObjectRecord, GRANT_SCOPE.READ);
    return {
      mediaObject: await this.loadAggregate(mediaObjectRecord),
      userRev: mediaObjectRecord.userRev,
    };
  }

  async createMediaObjects(
    vibe: string | undefined,
    mediaObjectInputs: CreateMediaObjectInput[],
    pendingMediaElementUploads: ReadonlyMap<string, PendingMediaElementUpload> = new Map(),
  ): Promise<MediaObjectAggregate[]> {
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
    const mediaElementUploads = this.mediaElementsService.createUploadContext(
      pendingMediaElementUploads,
    );

    return this.db.transaction(async (transaction: DatabaseTransaction) => {
      const createdMediaObjects: MediaObjectAggregate[] = [];
      if (vibeUuid) {
        await this.access.lockVibeScopeForWrite({
          transaction,
          vibeUuid,
          expectedOwnerUuid: ownerUuid,
          scope: GRANT_SCOPE.WRITE_OBJECTS,
        });
      } else {
        await this.access.assertRecordOwner(ownerUuid);
      }
      let nextVibePosition: number | undefined;
      if (vibeUuid) {
        const [maxPosition] = await transaction
          .select({ max: sql<number>`coalesce(max(${vibeMediaObjects.position}), -1)::int` })
          .from(vibeMediaObjects)
          .where(eq(vibeMediaObjects.vibeUuid, vibeUuid));
        nextVibePosition = (maxPosition?.max ?? -1) + 1;
      }
      for (const [mediaObjectIndex, mediaObjectInput] of mediaObjectInputs.entries()) {
        const mediaElementUuids = await this.mediaElementsService.createMediaElements({
          ownerUuid,
          mediaElementReferences: mediaObjectInput.elements,
          mediaElementUploads,
          transaction,
          validationPath: `/objects/${mediaObjectIndex}/elements`,
        });
        const mediaObjectUuid = uuidv7();
        const source = this.sourceForMediaObject(mediaObjectInput, mediaObjectIndex);
        this.assertM1IngestPolicy(source);
        const extensions = Object.fromEntries(
          Object.entries(mediaObjectInput).filter(([key]) => key.startsWith("x-")),
        );
        const newMediaObject: NewDbMediaObject = {
          uuid: mediaObjectUuid,
          ownerUuid,
          createdBy: this.actor.subject,
          type: mediaObjectInput.type,
          keys: mediaObjectInput.keys ?? {},
          source,
          inferred: {},
          extensions,
          rnetSchema: RNET_SCHEMA_VERSION,
        };
        const mediaObjectRecord = await this.createMediaObject({
          transaction,
          newMediaObject,
          vibeUuid,
          vibePosition:
            nextVibePosition === undefined ? undefined : nextVibePosition + mediaObjectIndex,
        });
        await this.setMediaObjectElements({
          transaction,
          mediaObjectUuid,
          mediaElementUuids,
        });
        createdMediaObjects.push({ mediaObject: mediaObjectRecord, mediaElementUuids });
      }
      this.mediaElementsService.assertAllUploadsUsed(mediaElementUploads);
      return createdMediaObjects;
    });
  }

  async setUser(
    mediaObjectUuid: string,
    expectedRev: number,
    properties: Record<string, unknown>,
  ): Promise<{ mediaObject: MediaObjectAggregate; userRev: number }> {
    await this.access.assertMediaObjectScope(mediaObjectUuid, GRANT_SCOPE.WRITE_USER);
    const updatedMediaObject = await this.updateMediaObjectBlock(
      mediaObjectUuid,
      GRANT_SCOPE.WRITE_USER,
      {
        block: "user",
        buildSnapshot: () => ({
          properties,
          updated_at: new Date().toISOString(),
        }),
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
            .where(
              and(eq(mediaObjects.uuid, mediaObjectUuid), eq(mediaObjects.userRev, expectedRev)),
            )
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
      },
    );
    return {
      mediaObject: await this.loadAggregate(updatedMediaObject),
      userRev: updatedMediaObject.userRev,
    };
  }

  async setInferred(
    mediaObjectUuid: string,
    task: string,
    entry: NonNullable<MediaObject["inferred"]>[string],
  ): Promise<MediaObjectAggregate> {
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
    const updatedMediaObject = await this.updateMediaObjectBlock(
      mediaObjectUuid,
      GRANT_SCOPE.WRITE_INFERRED,
      {
        block: "inferred",
        buildSnapshot: (currentMediaObject) => ({
          ...currentMediaObject.inferred,
          [key]: entry,
        }),
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
      },
    );
    return this.loadAggregate(updatedMediaObject);
  }

  private async updateMediaObjectBlock<Snapshot extends MediaObjectBlockSnapshot>(
    mediaObjectUuid: string,
    scope: GrantScope,
    update: MediaObjectBlockUpdate<Snapshot>,
  ): Promise<DbMediaObject> {
    return this.db.transaction(async (transaction: DatabaseTransaction) => {
      const currentMediaObject = await this.access.lockMediaObjectScopeForWrite({
        transaction,
        mediaObjectUuid,
        scope,
      });

      const snapshot = update.buildSnapshot(currentMediaObject);
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

  async loadAggregate(
    mediaObjectRecord: DbMediaObject,
    database: Database | DatabaseTransaction = this.db,
  ): Promise<MediaObjectAggregate> {
    const mediaElementReferences: MediaElementReferenceRow[] = await database
      .select({ uuid: mediaObjectElements.mediaElementUuid })
      .from(mediaObjectElements)
      .where(eq(mediaObjectElements.mediaObjectUuid, mediaObjectRecord.uuid))
      .orderBy(asc(mediaObjectElements.position));
    return {
      mediaObject: mediaObjectRecord,
      mediaElementUuids: mediaElementReferences.map((reference) => reference.uuid),
    };
  }

  private async createMediaObject({
    transaction,
    newMediaObject,
    vibeUuid,
    vibePosition,
  }: {
    transaction: DatabaseTransaction;
    newMediaObject: NewDbMediaObject;
    vibeUuid?: string;
    vibePosition?: number;
  }): Promise<DbMediaObject> {
    if (!newMediaObject.uuid) throw new Error("Media object UUID is required before persistence");
    if (!newMediaObject.ownerUuid) throw new Error("Media object owner is required");
    if (!newMediaObject.source) throw new Error("Media object source is required");
    await this.assertMediaObjectOrigins(
      transaction,
      newMediaObject.ownerUuid,
      newMediaObject.source,
    );

    const [mediaObject] = await transaction.insert(mediaObjects).values(newMediaObject).returning();
    if (!mediaObject) throw new Error("Media object insert did not return a row");
    await transaction
      .insert(mediaObjectOrigins)
      .values(
        newMediaObject.source.origins.map((uri) =>
          uri.startsWith("rnet://origin/")
            ? { mediaObjectUuid: mediaObject.uuid, originArtifactUuid: uriId(uri) }
            : { mediaObjectUuid: mediaObject.uuid, dmachineUuid: uriId(uri) },
        ),
      );
    await transaction.insert(mediaObjectRevisions).values({
      mediaObjectUuid: mediaObject.uuid,
      block: "source",
      rev: 1,
      snapshot: newMediaObject.source,
      actor: this.actor.subject,
    });
    if (vibeUuid !== undefined && vibePosition !== undefined) {
      await transaction.insert(vibeMediaObjects).values({
        vibeUuid,
        mediaObjectUuid: mediaObject.uuid,
        position: vibePosition,
      });
    }
    return mediaObject;
  }

  private async setMediaObjectElements({
    transaction,
    mediaObjectUuid,
    mediaElementUuids,
  }: {
    transaction: DatabaseTransaction;
    mediaObjectUuid: string;
    mediaElementUuids: string[];
  }): Promise<void> {
    if (!mediaElementUuids.length) return;
    await transaction.insert(mediaObjectElements).values(
      mediaElementUuids.map((mediaElementUuid, position) => ({
        mediaObjectUuid,
        mediaElementUuid,
        position,
      })),
    );
  }

  private sourceForMediaObject(
    input: CreateMediaObjectInput,
    index: number,
  ): MediaObject["source"] {
    if (this.actor.kind === "client") {
      if ("source" in input) {
        throw schemaProblem([
          { instancePath: `/objects/${index}/source`, message: "is store-authored for clients" },
        ]);
      }
      return {
        ingest: { method: "authored", reproducible: false },
        origins: [`rnet://client/${this.actor.uuid}`],
        properties: "properties" in input ? (input.properties ?? {}) : {},
      };
    }
    if (this.actor.kind === "user" && "source" in input) return input.source;
    throw grantMissing("owner");
  }

  private assertM1IngestPolicy(source: MediaObject["source"]): void {
    const ingest = source.ingest;
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
  }

  private async assertMediaObjectOrigins(
    transaction: DatabaseTransaction,
    ownerUuid: string,
    source: MediaObject["source"],
  ): Promise<void> {
    const originArtifactUuids = source.origins
      .filter((uri) => uri.startsWith("rnet://origin/"))
      .map(uriId);
    const dmachineUuids = source.origins
      .filter((uri) => !uri.startsWith("rnet://origin/"))
      .map(uriId);
    const originArtifactRows: { uuid: string; ownerUuid: string }[] = originArtifactUuids.length
      ? await transaction
          .select({ uuid: originArtifacts.uuid, ownerUuid: originArtifacts.ownerUuid })
          .from(originArtifacts)
          .where(
            and(
              inArray(originArtifacts.uuid, originArtifactUuids),
              isNull(originArtifacts.tombstonedAt),
            ),
          )
          .for("share")
      : [];
    const dmachineRows: { uuid: string }[] = dmachineUuids.length
      ? await transaction
          .select({ uuid: dmachines.uuid })
          .from(dmachines)
          .where(inArray(dmachines.uuid, dmachineUuids))
          .for("share")
      : [];
    const originArtifactsByUuid = new Map(
      originArtifactRows.map((originArtifact) => [originArtifact.uuid, originArtifact]),
    );
    const existingDmachineUuids = new Set(dmachineRows.map((dmachine) => dmachine.uuid));

    for (const uri of source.origins) {
      if (uri.startsWith("rnet://origin/")) {
        const originArtifact = originArtifactsByUuid.get(uriId(uri));
        if (!originArtifact) {
          throw schemaProblem([
            { instancePath: "/source/origins", message: `unknown origin ${uri}` },
          ]);
        }
        if (originArtifact.ownerUuid !== ownerUuid) throw grantMissing("owner");
      } else {
        if (!existingDmachineUuids.has(uriId(uri))) {
          throw schemaProblem([
            { instancePath: "/source/origins", message: `unknown client ${uri}` },
          ]);
        }
      }
    }
  }
}
