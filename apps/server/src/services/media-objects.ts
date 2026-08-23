import { validateMediaObject, type MediaObject } from "@rnet/types";
import { and, asc, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { Actor } from "../auth.ts";
import type { Database } from "../db/index.ts";
import { mediaElements } from "../db/models/media-element.ts";
import { mediaObjectElements } from "../db/models/media-object-element.ts";
import { mediaObjectOrigins } from "../db/models/media-object-origin.ts";
import { mediaObjectRevisions } from "../db/models/media-object-revision.ts";
import { mediaObjects } from "../db/models/media-object.ts";
import { originArtifacts } from "../db/models/origin-artifact.ts";
import { vibeMediaObjects } from "../db/models/vibe-media-object.ts";
import { vibes } from "../db/models/vibe.ts";
import { grantMissing, notFound, Problem } from "../errors.ts";
import type { AccessService, DbVibe } from "./access.ts";
import type { IdentityService } from "./identities.ts";
import { schemaProblem } from "./problems.ts";
import { uriId } from "./uris.ts";

export type DbMediaObject = typeof mediaObjects.$inferSelect;

export interface CreateMediaObjectsInput {
  vibe?: string;
  objects: unknown[];
}

export interface SetMediaObjectUserInput {
  properties: Record<string, unknown>;
}

export interface SetMediaObjectInferredInput {
  task: string;
  entry: NonNullable<MediaObject["inferred"]>[string];
}

export class MediaObjectService {
  constructor(
    private readonly db: Database,
    private readonly access: AccessService,
    private readonly identities: IdentityService,
  ) {}

  async getMediaObject(actor: Actor, uuid: string): Promise<{ document: MediaObject; userRev: number }> {
    const [mediaObjectRecord] = await this.db.select().from(mediaObjects).where(eq(mediaObjects.uuid, uuid));
    if (!mediaObjectRecord) throw notFound("Object");
    if (!(await this.access.canReadMediaObject(actor, uuid))) throw grantMissing("read");
    return { document: await this.toDocument(mediaObjectRecord), userRev: mediaObjectRecord.userRev };
  }

  async createMediaObjects(actor: Actor, body: CreateMediaObjectsInput): Promise<MediaObject[]> {
    await this.access.assertAuthenticated(actor);
    const vibeUuid = body.vibe ? uriId(body.vibe) : undefined;
    let targetVibe: DbVibe | undefined;
    if (actor.kind === "client") {
      if (!vibeUuid) throw schemaProblem([{ instancePath: "/vibe", message: "is required for clients" }]);
      targetVibe = await this.access.assertVibeScope(actor, vibeUuid, "write:objects");
    } else if (vibeUuid) {
      targetVibe = await this.access.assertVibeScope(actor, vibeUuid, "write:objects");
    }
    const ownerUuid = targetVibe?.ownerUuid ?? (actor.kind === "user" ? actor.uuid : undefined);
    if (!ownerUuid) throw grantMissing("owner");
    const actorOwnsRecords = actor.kind === "user" && actor.uuid === ownerUuid;

    const mediaObjectDocuments = body.objects.map((item, index) =>
      this.normalizeMediaObject(actor, ownerUuid, item, index),
    );
    for (const mediaObjectDocument of mediaObjectDocuments) {
      await this.assertMediaObjectReferences(actor, vibeUuid, ownerUuid, mediaObjectDocument);
    }

    return this.db.transaction(async (transaction) => {
      const createdMediaObjects: MediaObject[] = [];
      let nextVibePosition: number | undefined;
      if (vibeUuid) {
        await transaction.execute(sql`SELECT 1 FROM ${vibes} WHERE ${vibes.uuid} = ${vibeUuid}::uuid FOR UPDATE`);
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
          createdBy: actor.subject,
          createdForVibe: actorOwnsRecords ? null : vibeUuid,
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
        await transaction.insert(mediaObjectOrigins).values(
          mediaObjectDocument.source.origins.map((uri) =>
            uri.startsWith("rnet://origin/")
              ? { mediaObjectUuid, originArtifactUuid: uriId(uri) }
              : { mediaObjectUuid, machineUuid: uriId(uri) },
          ),
        );
        await transaction.insert(mediaObjectRevisions).values({
          mediaObjectUuid,
          block: "source",
          rev: 1,
          snapshot: mediaObjectDocument.source,
          actor: actor.subject,
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
    actor: Actor,
    mediaObjectUuid: string,
    expectedRev: number,
    value: SetMediaObjectUserInput,
  ): Promise<{ document: MediaObject; userRev: number }> {
    await this.access.assertMediaObjectScope(actor, mediaObjectUuid, "write:user");
    const candidateUser: NonNullable<MediaObject["user"]> = {
      properties: value.properties,
      updated_at: new Date().toISOString(),
    };
    const updatedMediaObject = await this.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`SELECT 1 FROM ${mediaObjects} WHERE ${mediaObjects.uuid} = ${mediaObjectUuid}::uuid FOR UPDATE`,
      );
      const [currentMediaObject] = await transaction
        .select()
        .from(mediaObjects)
        .where(eq(mediaObjects.uuid, mediaObjectUuid));
      if (!currentMediaObject) throw notFound("Object");
      const mediaElementReferences = await transaction
        .select({ uuid: mediaObjectElements.mediaElementUuid })
        .from(mediaObjectElements)
        .where(eq(mediaObjectElements.mediaObjectUuid, mediaObjectUuid))
        .orderBy(asc(mediaObjectElements.position));
      const candidateMediaObject = this.toDocumentFromMediaElementUuids(
        { ...currentMediaObject, user: candidateUser },
        mediaElementReferences.map((reference) => reference.uuid),
      );
      const validation = validateMediaObject(candidateMediaObject);
      if (!validation.ok) throw schemaProblem(validation.issues);
      if (currentMediaObject.userRev !== expectedRev) {
        throw new Problem(409, "revision_conflict", "Revision conflict", "The user block changed", {
          expected: expectedRev,
          current: currentMediaObject.userRev,
        });
      }
      const [nextMediaObject] = await transaction
        .update(mediaObjects)
        .set({ user: candidateUser, userRev: sql`${mediaObjects.userRev} + 1` })
        .where(and(eq(mediaObjects.uuid, mediaObjectUuid), eq(mediaObjects.userRev, expectedRev)))
        .returning();
      if (!nextMediaObject) {
        throw new Problem(409, "revision_conflict", "Revision conflict", "The user block changed");
      }
      await transaction.insert(mediaObjectRevisions).values({
        mediaObjectUuid,
        block: "user",
        rev: nextMediaObject.userRev,
        snapshot: candidateUser,
        actor: actor.subject,
      });
      return nextMediaObject;
    });
    return {
      document: await this.toDocument(updatedMediaObject),
      userRev: updatedMediaObject.userRev,
    };
  }

  async setInferred(
    actor: Actor,
    mediaObjectUuid: string,
    body: SetMediaObjectInferredInput,
  ): Promise<MediaObject> {
    await this.access.assertMediaObjectScope(actor, mediaObjectUuid, "write:inferred");
    const task = body.task;
    const entry = body.entry;
    const key = actor.kind === "client" ? `${actor.name}:${task}` : task;
    if (actor.kind === "client" && task.includes(":")) {
      throw new Problem(403, "writer_namespace_mismatch", "Writer namespace mismatch", "Pass a bare task name");
    }
    const updatedMediaObject = await this.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`SELECT 1 FROM ${mediaObjects} WHERE ${mediaObjects.uuid} = ${mediaObjectUuid}::uuid FOR UPDATE`,
      );
      const [currentMediaObject] = await transaction
        .select()
        .from(mediaObjects)
        .where(eq(mediaObjects.uuid, mediaObjectUuid));
      if (!currentMediaObject) throw notFound("Object");
      const inferred: NonNullable<MediaObject["inferred"]> = {
        ...currentMediaObject.inferred,
        [key]: entry,
      };
      const mediaElementReferences = await transaction
        .select({ uuid: mediaObjectElements.mediaElementUuid })
        .from(mediaObjectElements)
        .where(eq(mediaObjectElements.mediaObjectUuid, mediaObjectUuid))
        .orderBy(asc(mediaObjectElements.position));
      const candidateMediaObject = this.toDocumentFromMediaElementUuids(
        { ...currentMediaObject, inferred },
        mediaElementReferences.map((reference) => reference.uuid),
      );
      const validation = validateMediaObject(candidateMediaObject);
      if (!validation.ok) throw schemaProblem(validation.issues);
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
      await transaction.insert(mediaObjectRevisions).values({
        mediaObjectUuid,
        block: "inferred",
        rev: (maxRevision?.max ?? 0) + 1,
        snapshot: inferred,
        actor: actor.subject,
      });
      return nextMediaObject;
    });
    return this.toDocument(updatedMediaObject);
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

  private normalizeMediaObject(actor: Actor, ownerUuid: string, input: unknown, index: number): MediaObject {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw schemaProblem([{ instancePath: `/objects/${index}`, message: "must be an object" }]);
    }
    const rawMediaObject = input as Record<string, unknown>;
    const mediaObjectUuid = typeof rawMediaObject.uri === "string" ? uriId(rawMediaObject.uri) : uuidv7();
    const owner = `rnet://id/${ownerUuid}`;
    if (rawMediaObject.owner !== undefined && rawMediaObject.owner !== owner) {
      throw schemaProblem([
        { instancePath: `/objects/${index}/owner`, message: "conflicts with the store-assigned owner" },
      ]);
    }
    const candidateMediaObject =
      actor.kind === "client"
        ? {
            rnet_schema: "0.1",
            uri: `rnet://object/${mediaObjectUuid}`,
            owner,
            type: rawMediaObject.type,
            elements: rawMediaObject.elements ?? [],
            ...(rawMediaObject.keys === undefined ? {} : { keys: rawMediaObject.keys }),
            source: {
              ingest: { method: "authored", reproducible: false },
              origins: [`rnet://client/${actor.uuid}`],
              properties: rawMediaObject.properties ?? {},
            },
          }
        : { ...rawMediaObject, owner };
    const validation = validateMediaObject(candidateMediaObject);
    if (!validation.ok) throw schemaProblem(validation.issues, `/objects/${index}`);
    if (validation.value.user !== undefined || Object.keys(validation.value.inferred ?? {}).length) {
      throw schemaProblem([{ instancePath: `/objects/${index}`, message: "creation cannot write user or inferred" }]);
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

  private async assertMediaObjectReferences(
    actor: Actor,
    vibeUuid: string | undefined,
    ownerUuid: string,
    mediaObjectDocument: MediaObject,
  ): Promise<void> {
    for (const uri of mediaObjectDocument.elements) {
      const mediaElementUuid = uriId(uri);
      const [mediaElementRecord] = await this.db
        .select({
          uuid: mediaElements.uuid,
          ownerUuid: mediaElements.ownerUuid,
          createdBy: mediaElements.createdBy,
          createdForVibe: mediaElements.createdForVibe,
        })
        .from(mediaElements)
        .where(eq(mediaElements.uuid, mediaElementUuid));
      if (!mediaElementRecord) {
        throw schemaProblem([{ instancePath: "/elements", message: `unknown element ${uri}` }]);
      }
      if (mediaElementRecord.ownerUuid !== ownerUuid) throw grantMissing("owner");
      const actorOwnsRecord = actor.kind === "user" && actor.uuid === ownerUuid;
      if (!actorOwnsRecord) {
        const createdForTarget =
          mediaElementRecord.createdBy === actor.subject && mediaElementRecord.createdForVibe === vibeUuid;
        const readableInTarget = vibeUuid
          ? await this.canReadMediaElementInVibe(actor, mediaElementUuid, vibeUuid)
          : false;
        if (!createdForTarget && !readableInTarget) throw grantMissing("read");
      }
    }
    for (const uri of mediaObjectDocument.source.origins) {
      if (uri.startsWith("rnet://origin/")) {
        const [originArtifact] = await this.db
          .select({ uuid: originArtifacts.uuid, ownerUuid: originArtifacts.ownerUuid })
          .from(originArtifacts)
          .where(eq(originArtifacts.uuid, uriId(uri)));
        if (!originArtifact) {
          throw schemaProblem([{ instancePath: "/source/origins", message: `unknown origin ${uri}` }]);
        }
        if (originArtifact.ownerUuid !== ownerUuid) throw grantMissing("owner");
      } else if (!(await this.identities.hasMachineUuid(uriId(uri)))) {
        throw schemaProblem([{ instancePath: "/source/origins", message: `unknown client ${uri}` }]);
      }
    }
  }

  private async canReadMediaElementInVibe(
    actor: Actor,
    mediaElementUuid: string,
    vibeUuid: string,
  ): Promise<boolean> {
    try {
      await this.access.assertVibeScope(actor, vibeUuid, "read");
    } catch (error) {
      if (error instanceof Problem && [403, 404].includes(error.status)) return false;
      throw error;
    }
    const [membership] = await this.db
      .select({ mediaObjectUuid: mediaObjectElements.mediaObjectUuid })
      .from(mediaObjectElements)
      .innerJoin(vibeMediaObjects, eq(vibeMediaObjects.mediaObjectUuid, mediaObjectElements.mediaObjectUuid))
      .where(
        and(
          eq(mediaObjectElements.mediaElementUuid, mediaElementUuid),
          eq(vibeMediaObjects.vibeUuid, vibeUuid),
        ),
      );
    return Boolean(membership);
  }

  private toDocumentFromMediaElementUuids(
    mediaObjectRecord: DbMediaObject,
    mediaElementUuids: string[],
  ): MediaObject {
    return {
      rnet_schema: "0.1",
      uri: `rnet://object/${mediaObjectRecord.uuid}`,
      owner: `rnet://id/${mediaObjectRecord.ownerUuid}`,
      type: mediaObjectRecord.type,
      elements: mediaElementUuids.map((uuid) => `rnet://element/${uuid}`),
      ...(Object.keys(mediaObjectRecord.keys).length ? { keys: mediaObjectRecord.keys } : {}),
      source: mediaObjectRecord.source,
      ...(mediaObjectRecord.user ? { user: mediaObjectRecord.user } : {}),
      ...(Object.keys(mediaObjectRecord.inferred).length ? { inferred: mediaObjectRecord.inferred } : {}),
      ...mediaObjectRecord.extensions,
    } as MediaObject;
  }
}
