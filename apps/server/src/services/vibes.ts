import {
  RNET_SCHEMA_VERSION,
  validateSchema,
  type Grant,
  type MediaObject,
  type Vibe,
} from "@rnet/types";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { Database, DatabaseTransaction } from "../db/index.ts";
import { grants } from "../db/models/grant.ts";
import { mediaObjects } from "../db/models/media-object.ts";
import { vibeMediaObjects } from "../db/models/vibe-media-object.ts";
import { vibeRevisions } from "../db/models/vibe-revision.ts";
import { vibes } from "../db/models/vibe.ts";
import { grantMissing, notFound, Problem } from "../errors.ts";
import { AccessService, type DbVibe } from "./access.ts";
import { IdentityService } from "./identities.ts";
import { MediaObjectService } from "./media-objects.ts";
import { schemaProblem } from "./problems.ts";
import type { ServiceContext } from "./types.ts";
import { uriId } from "./uris.ts";

export class VibeService {
  private readonly db: Database;
  private readonly actor: ServiceContext["actor"];
  private readonly access: AccessService;
  private readonly identities: IdentityService;
  private readonly mediaObjectService: MediaObjectService;

  constructor(context: ServiceContext) {
    this.db = context.db;
    this.actor = context.actor;
    this.access = new AccessService(context);
    this.identities = new IdentityService(context.db);
    this.mediaObjectService = new MediaObjectService(context);
  }

  async listVibes(): Promise<Vibe[]> {
    const vibeRows =
      this.actor.kind === "user"
        ? await this.db
            .select()
            .from(vibes)
            .where(eq(vibes.ownerUuid, this.actor.uuid))
            .orderBy(asc(vibes.createdAt))
        : await this.db
            .select({ vibe: vibes })
            .from(vibes)
            .innerJoin(grants, eq(grants.vibeUuid, vibes.uuid))
            .where(
              and(
                eq(grants.subject, this.actor.subject),
                isNull(grants.revokedAt),
                sql`${grants.scopes} @> '["read"]'::jsonb`,
              ),
            )
            .orderBy(asc(vibes.createdAt))
            .then((items) => items.map((item) => item.vibe));
    return Promise.all(vibeRows.map((vibe) => this.toDocument(vibe)));
  }

  async createVibe(input: Pick<Vibe, "title" | "pull" | "grants">): Promise<Vibe> {
    await this.access.assertAuthenticated();
    if (this.actor.kind !== "user") throw grantMissing("owner");
    const candidateVibeUuid = uuidv7();
    const candidateVibe = {
      rnet_schema: RNET_SCHEMA_VERSION,
      uri: `rnet://vibe/${candidateVibeUuid}`,
      title: input.title,
      owner: `rnet://id/${this.actor.uuid}`,
      objects: [],
      ...(input.pull === undefined ? {} : { pull: input.pull }),
      ...(input.grants === undefined ? {} : { grants: input.grants }),
    };
    const validation = validateSchema("vibe", candidateVibe);
    if (!validation.ok) throw schemaProblem(validation.issues);
    const vibeDocument = validation.value;
    const vibeUuid = uriId(vibeDocument.uri);
    await this.assertGrantSubjects(vibeDocument.grants ?? []);

    return this.db.transaction(async (transaction: DatabaseTransaction) => {
      const [vibeRecord] = await transaction
        .insert(vibes)
        .values({
          uuid: vibeUuid,
          title: vibeDocument.title,
          ownerUuid: uriId(vibeDocument.owner),
          rnetSchema: vibeDocument.rnet_schema,
          pullConfig: vibeDocument.pull,
          inferred: vibeDocument.inferred ?? {},
        })
        .returning();
      if (!vibeRecord) throw new Error("Vibe insert did not return a row");
      if (vibeDocument.grants?.length) {
        await transaction.insert(grants).values(
          vibeDocument.grants.map((grant) => ({
            vibeUuid,
            subject: grant.subject,
            scopes: grant.scope,
          })),
        );
      }
      await transaction.insert(vibeRevisions).values({
        vibeUuid,
        rev: 1,
        actor: this.actor.subject,
        snapshot: snapshotVibe(vibeRecord, vibeDocument.grants ?? []),
        membershipDelta: { added: [], removed: [] },
      });
      return vibeDocument;
    });
  }

  async getVibe(vibeUuid: string): Promise<Vibe> {
    const vibeRecord = await this.access.assertVibeScope(vibeUuid, "read");
    return this.toDocument(vibeRecord);
  }

  async updateVibe(
    vibeUuid: string,
    patch: Partial<Pick<Vibe, "title" | "pull" | "grants">>,
  ): Promise<Vibe> {
    await this.access.assertVibeOwner(vibeUuid);
    const currentVibe = await this.getVibe(vibeUuid);
    const allowed = new Set(["title", "pull", "grants"]);
    const extra = Object.keys(patch).find((key) => !allowed.has(key));
    if (extra)
      throw schemaProblem([{ instancePath: `/${extra}`, message: "property is not patchable" }]);
    const candidateVibe = { ...currentVibe, ...patch };
    const validation = validateSchema("vibe", candidateVibe);
    if (!validation.ok) throw schemaProblem(validation.issues);
    const vibeDocument = validation.value;
    const validatedVibeUuid = uriId(vibeDocument.uri);
    await this.assertGrantSubjects(vibeDocument.grants ?? []);

    return this.db.transaction(async (transaction: DatabaseTransaction) => {
      const [vibeRecord] = await transaction
        .update(vibes)
        .set({
          title: vibeDocument.title,
          pullConfig: vibeDocument.pull,
          rev: sql`${vibes.rev} + 1`,
        })
        .where(eq(vibes.uuid, validatedVibeUuid))
        .returning();
      if (!vibeRecord) throw notFound("Vibe");
      if (patch.grants !== undefined) {
        const existingGrants = await transaction
          .select()
          .from(grants)
          .where(eq(grants.vibeUuid, validatedVibeUuid));
        const nextGrants = new Map(
          (vibeDocument.grants ?? []).map((grant) => [grant.subject, grant]),
        );
        const now = new Date();
        for (const existingGrant of existingGrants) {
          const replacementGrant = nextGrants.get(existingGrant.subject);
          if (replacementGrant) {
            await transaction
              .update(grants)
              .set({
                scopes: replacementGrant.scope,
                revokedAt: null,
                ...(existingGrant.revokedAt ? { grantedAt: now } : {}),
              })
              .where(
                and(
                  eq(grants.vibeUuid, validatedVibeUuid),
                  eq(grants.subject, existingGrant.subject),
                ),
              );
            nextGrants.delete(existingGrant.subject);
          } else if (!existingGrant.revokedAt) {
            await transaction
              .update(grants)
              .set({ revokedAt: now })
              .where(
                and(
                  eq(grants.vibeUuid, validatedVibeUuid),
                  eq(grants.subject, existingGrant.subject),
                ),
              );
          }
        }
        if (nextGrants.size) {
          await transaction.insert(grants).values(
            [...nextGrants.values()].map((grant) => ({
              vibeUuid: validatedVibeUuid,
              subject: grant.subject,
              scopes: grant.scope,
            })),
          );
        }
      }
      await transaction.insert(vibeRevisions).values({
        vibeUuid: validatedVibeUuid,
        rev: vibeRecord.rev,
        actor: this.actor.subject,
        snapshot: snapshotVibe(vibeRecord, vibeDocument.grants ?? []),
      });
      return vibeDocument;
    });
  }

  async deleteVibe(vibeUuid: string): Promise<void> {
    await this.access.assertVibeOwner(vibeUuid);
    await this.db.delete(vibes).where(eq(vibes.uuid, vibeUuid));
  }

  async listMediaObjects(vibeUuid: string): Promise<MediaObject[]> {
    await this.access.assertVibeScope(vibeUuid, "read");
    const mediaObjectRows = await this.db
      .select({ mediaObject: mediaObjects })
      .from(vibeMediaObjects)
      .innerJoin(mediaObjects, eq(mediaObjects.uuid, vibeMediaObjects.mediaObjectUuid))
      .where(eq(vibeMediaObjects.vibeUuid, vibeUuid))
      .orderBy(asc(vibeMediaObjects.position), asc(vibeMediaObjects.addedAt));
    return Promise.all(
      mediaObjectRows.map(({ mediaObject }) => this.mediaObjectService.toDocument(mediaObject)),
    );
  }

  async addMediaObjectRefs(vibeUuid: string, references: string[]): Promise<void> {
    await this.access.assertVibeOwner(vibeUuid);
    if (this.actor.kind !== "user") throw new Error("Owner assertion did not narrow the actor");
    const mediaObjectUuids = references.map(uriId);
    if (new Set(mediaObjectUuids).size !== mediaObjectUuids.length) {
      throw schemaProblem([
        { instancePath: "/objects", message: "must not contain duplicate object URIs" },
      ]);
    }
    for (const mediaObjectUuid of mediaObjectUuids) {
      const [mediaObjectRecord] = await this.db
        .select({ ownerUuid: mediaObjects.ownerUuid })
        .from(mediaObjects)
        .where(eq(mediaObjects.uuid, mediaObjectUuid));
      if (!mediaObjectRecord) throw notFound("Object");
      if (mediaObjectRecord.ownerUuid !== this.actor.uuid) throw grantMissing("owner");
      const [membership] = await this.db
        .select({ mediaObjectUuid: vibeMediaObjects.mediaObjectUuid })
        .from(vibeMediaObjects)
        .where(
          and(
            eq(vibeMediaObjects.vibeUuid, vibeUuid),
            eq(vibeMediaObjects.mediaObjectUuid, mediaObjectUuid),
          ),
        );
      if (membership) {
        throw schemaProblem([
          {
            instancePath: "/objects",
            message: `object is already in the Vibe: ${mediaObjectUuid}`,
          },
        ]);
      }
    }
    await this.db.transaction(async (transaction: DatabaseTransaction) => {
      await transaction.execute(
        sql`SELECT 1 FROM ${vibes} WHERE ${vibes.uuid} = ${vibeUuid}::uuid FOR UPDATE`,
      );
      const [maxPosition] = await transaction
        .select({ max: sql<number>`coalesce(max(${vibeMediaObjects.position}), -1)::int` })
        .from(vibeMediaObjects)
        .where(eq(vibeMediaObjects.vibeUuid, vibeUuid));
      const firstPosition = (maxPosition?.max ?? -1) + 1;
      await transaction.insert(vibeMediaObjects).values(
        mediaObjectUuids.map((mediaObjectUuid, index) => ({
          vibeUuid,
          mediaObjectUuid,
          position: firstPosition + index,
        })),
      );
      await this.recordMembershipChange(transaction, vibeUuid, references, []);
    });
  }

  async removeMediaObjectRefs(vibeUuid: string, references: string[]): Promise<void> {
    await this.access.assertVibeOwner(vibeUuid);
    const mediaObjectUuids = references.map(uriId);
    await this.db.transaction(async (transaction: DatabaseTransaction) => {
      if (mediaObjectUuids.length) {
        await transaction
          .delete(vibeMediaObjects)
          .where(
            and(
              eq(vibeMediaObjects.vibeUuid, vibeUuid),
              inArray(vibeMediaObjects.mediaObjectUuid, mediaObjectUuids),
            ),
          );
      }
      await this.recordMembershipChange(transaction, vibeUuid, [], references);
    });
  }

  private async assertGrantSubjects(candidateGrants: Grant[]): Promise<void> {
    const seenSubjects = new Set<string>();
    for (const grant of candidateGrants) {
      if (seenSubjects.has(grant.subject)) {
        throw schemaProblem([
          { instancePath: "/grants", message: `duplicate subject ${grant.subject}` },
        ]);
      }
      seenSubjects.add(grant.subject);
      if (grant.subject === "public") continue;
      if (grant.subject.startsWith("client:")) {
        if (await this.identities.hasDmachineName(grant.subject.slice("client:".length))) continue;
      } else if (grant.subject.startsWith("id:rnet://id/")) {
        if (await this.identities.hasUserUuid(grant.subject.slice("id:rnet://id/".length)))
          continue;
      }
      throw new Problem(
        422,
        "schema_violation",
        "Unknown grant subject",
        `This store cannot resolve ${grant.subject}`,
        { errors: [{ pointer: "/grants", message: "unknown subject namespace or identity" }] },
      );
    }
  }

  private async toDocument(vibeRecord: DbVibe): Promise<Vibe> {
    const [memberships, activeGrants] = await Promise.all([
      this.db
        .select({ uuid: vibeMediaObjects.mediaObjectUuid })
        .from(vibeMediaObjects)
        .where(eq(vibeMediaObjects.vibeUuid, vibeRecord.uuid))
        .orderBy(asc(vibeMediaObjects.position), asc(vibeMediaObjects.addedAt)),
      this.db
        .select()
        .from(grants)
        .where(and(eq(grants.vibeUuid, vibeRecord.uuid), isNull(grants.revokedAt))),
    ]);
    return {
      rnet_schema: RNET_SCHEMA_VERSION,
      uri: `rnet://vibe/${vibeRecord.uuid}`,
      title: vibeRecord.title,
      owner: `rnet://id/${vibeRecord.ownerUuid}`,
      objects: memberships.map((membership) => `rnet://object/${membership.uuid}`),
      created_at: vibeRecord.createdAt.toISOString(),
      ...(vibeRecord.pullConfig ? { pull: vibeRecord.pullConfig } : {}),
      ...(activeGrants.length
        ? { grants: activeGrants.map((grant) => ({ subject: grant.subject, scope: grant.scopes })) }
        : {}),
      ...(Object.keys(vibeRecord.inferred).length ? { inferred: vibeRecord.inferred } : {}),
      ...vibeRecord.extensions,
    } as Vibe;
  }

  private async recordMembershipChange(
    transaction: DatabaseTransaction,
    vibeUuid: string,
    added: string[],
    removed: string[],
  ): Promise<void> {
    const [vibeRecord] = await transaction
      .update(vibes)
      .set({ rev: sql`${vibes.rev} + 1` })
      .where(eq(vibes.uuid, vibeUuid))
      .returning();
    if (!vibeRecord) return;
    const activeGrants = await transaction
      .select()
      .from(grants)
      .where(and(eq(grants.vibeUuid, vibeUuid), isNull(grants.revokedAt)));
    await transaction.insert(vibeRevisions).values({
      vibeUuid,
      rev: vibeRecord.rev,
      actor: this.actor.subject,
      snapshot: snapshotVibe(
        vibeRecord,
        activeGrants.map((grant) => ({ subject: grant.subject, scope: grant.scopes })),
      ),
      membershipDelta: { added, removed },
    });
  }
}

function snapshotVibe(vibeRecord: DbVibe, activeGrants: Grant[]): Record<string, unknown> {
  return {
    title: vibeRecord.title,
    inferred: vibeRecord.inferred,
    pull_config: vibeRecord.pullConfig,
    grants: activeGrants,
  };
}
