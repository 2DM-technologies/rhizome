import type { Grant } from "@rnet/types";
import type {
  CreateVibeRequest,
  MediaObjectRefsRequest,
  UpdateVibeRequest,
} from "@rhizome/store-contract";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { Database, DatabaseTransaction } from "../db/index.ts";
import { grants, GRANT_SCOPE, type DbGrant } from "../db/models/grant.ts";
import { mediaObjects, type DbMediaObject } from "../db/models/media-object.ts";
import { vibeMediaObjects } from "../db/models/vibe-media-object.ts";
import { vibeRevisions } from "../db/models/vibe-revision.ts";
import { vibes, type DbVibe, type NewDbVibe } from "../db/models/vibe.ts";
import { grantMissing, notFound, Problem } from "../errors.ts";
import { RNET_SCHEMA_VERSION } from "../rnet.ts";
import type { MediaObjectAggregate } from "../serializers/media-object-serializer.ts";
import type { VibeAggregate } from "../serializers/vibe-serializer.ts";
import { AccessService } from "./access-service.ts";
import { IdentityService } from "./identity-service.ts";
import { MediaObjectsService } from "./media-object-service.ts";
import { schemaProblem } from "./problems.ts";
import type { ServiceContext } from "./types.ts";
import { uriId } from "./uris.ts";
import { snapshotVibe } from "./vibe-snapshot.ts";

export class VibesService {
  private readonly db: Database;
  private readonly actor: ServiceContext["actor"];
  private readonly access: AccessService;
  private readonly identities: IdentityService;
  private readonly mediaObjectsService: MediaObjectsService;

  constructor(context: ServiceContext) {
    this.db = context.db;
    this.actor = context.actor;
    this.access = new AccessService(context);
    this.identities = new IdentityService(context.db);
    this.mediaObjectsService = new MediaObjectsService(context);
  }

  async listVibes(): Promise<VibeAggregate[]> {
    let vibeRows: DbVibe[];
    if (this.actor.kind === "user") {
      const [ownedVibeRows, grantedVibeRows] = await Promise.all([
        this.db
          .select()
          .from(vibes)
          .where(eq(vibes.ownerUuid, this.actor.uuid))
          .orderBy(asc(vibes.createdAt)),
        this.db
          .select({ vibe: vibes })
          .from(vibes)
          .innerJoin(grants, eq(grants.vibeUuid, vibes.uuid))
          .where(
            and(
              eq(grants.subject, this.actor.subject),
              isNull(grants.revokedAt),
              sql`${grants.scopes} @> ${JSON.stringify([GRANT_SCOPE.READ])}::jsonb`,
            ),
          )
          .orderBy(asc(vibes.createdAt)),
      ]);
      // Owners can also have an explicit grant. Keep the collection unique and preserve the
      // chronological ordering promised by the previous owner-only query.
      vibeRows = [
        ...new Map(
          [...ownedVibeRows, ...grantedVibeRows.map(({ vibe }) => vibe)].map((vibe) => [
            vibe.uuid,
            vibe,
          ]),
        ).values(),
      ].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    } else {
      const grantedVibeRows: { vibe: DbVibe }[] = await this.db
        .select({ vibe: vibes })
        .from(vibes)
        .innerJoin(grants, eq(grants.vibeUuid, vibes.uuid))
        .where(
          and(
            eq(grants.subject, this.actor.subject),
            isNull(grants.revokedAt),
            sql`${grants.scopes} @> ${JSON.stringify([GRANT_SCOPE.READ])}::jsonb`,
          ),
        )
        .orderBy(asc(vibes.createdAt));
      vibeRows = grantedVibeRows.map(({ vibe }) => vibe);
    }
    return Promise.all(vibeRows.map((vibe) => this.loadAggregate(vibe)));
  }

  async createVibe(input: CreateVibeRequest): Promise<VibeAggregate> {
    await this.access.assertAuthenticated();
    if (this.actor.kind !== "user") throw grantMissing("owner");
    assertNoIntroducedPullSources(input.pull?.sources, []);
    const vibeUuid = uuidv7();
    const candidateGrants = input.grants ?? [];
    await this.assertGrantSubjects(candidateGrants);
    const newVibe: NewDbVibe = {
      uuid: vibeUuid,
      title: input.title,
      ownerUuid: this.actor.uuid,
      rnetSchema: RNET_SCHEMA_VERSION,
      pullConfig: input.pull,
      inferred: {},
    };

    return this.db.transaction(async (transaction: DatabaseTransaction) => {
      const [vibeRecord] = await transaction.insert(vibes).values(newVibe).returning();
      if (!vibeRecord) throw new Error("Vibe insert did not return a row");
      let grantRecords: DbGrant[] = [];
      if (candidateGrants.length) {
        grantRecords = await transaction
          .insert(grants)
          .values(
            candidateGrants.map((grant) => ({
              vibeUuid,
              subject: grant.subject,
              scopes: grant.scope,
            })),
          )
          .returning();
      }
      await transaction.insert(vibeRevisions).values({
        vibeUuid,
        rev: 1,
        actor: this.actor.subject,
        snapshot: snapshotVibe(vibeRecord, candidateGrants),
        membershipDelta: { added: [], removed: [] },
      });
      return { vibe: vibeRecord, grants: grantRecords, mediaObjectUuids: [] };
    });
  }

  async getVibe(vibeUuid: string): Promise<VibeAggregate> {
    const vibeRecord = await this.access.assertVibeScope(vibeUuid, GRANT_SCOPE.READ);
    return this.loadAggregate(vibeRecord);
  }

  /** An automatic import name may replace only the still-current placeholder. */
  async renameVibeIfTitle(vibeUuid: string, expectedTitle: string, title: string): Promise<void> {
    await this.access.assertVibeOwner(vibeUuid);
    await this.db.transaction(async (transaction) => {
      const [updated] = await transaction
        .update(vibes)
        .set({ title, rev: sql`${vibes.rev} + 1` })
        .where(and(eq(vibes.uuid, vibeUuid), eq(vibes.title, expectedTitle)))
        .returning();
      if (!updated) return;
      const activeGrants = await transaction
        .select()
        .from(grants)
        .where(and(eq(grants.vibeUuid, vibeUuid), isNull(grants.revokedAt)));
      await transaction.insert(vibeRevisions).values({
        vibeUuid,
        rev: updated.rev,
        actor: this.actor.subject,
        snapshot: snapshotVibe(
          updated,
          activeGrants.map((grant) => ({ subject: grant.subject, scope: grant.scopes })),
        ),
      });
    });
  }

  async updateVibe(vibeUuid: string, patch: UpdateVibeRequest): Promise<VibeAggregate> {
    await this.access.assertVibeOwner(vibeUuid);
    const currentVibe = await this.getVibe(vibeUuid);
    const candidateGrants =
      patch.grants ??
      currentVibe.grants.map((grant) => ({ subject: grant.subject, scope: grant.scopes }));
    await this.assertGrantSubjects(candidateGrants);
    if (patch.pull !== undefined) {
      assertNoIntroducedPullSources(patch.pull.sources, currentVibe.vibe.pullConfig?.sources ?? []);
    }

    const vibeRecord = await this.db.transaction(async (transaction: DatabaseTransaction) => {
      const [vibeRecord] = await transaction
        .update(vibes)
        .set({
          title: patch.title ?? currentVibe.vibe.title,
          pullConfig: patch.pull ?? currentVibe.vibe.pullConfig,
          rev: sql`${vibes.rev} + 1`,
        })
        .where(eq(vibes.uuid, vibeUuid))
        .returning();
      if (!vibeRecord) throw notFound("Vibe");
      if (patch.grants !== undefined) {
        const existingGrants = await transaction
          .select()
          .from(grants)
          .where(eq(grants.vibeUuid, vibeUuid));
        const nextGrants = new Map(candidateGrants.map((grant) => [grant.subject, grant]));
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
              .where(and(eq(grants.vibeUuid, vibeUuid), eq(grants.subject, existingGrant.subject)));
            nextGrants.delete(existingGrant.subject);
          } else if (!existingGrant.revokedAt) {
            await transaction
              .update(grants)
              .set({ revokedAt: now })
              .where(and(eq(grants.vibeUuid, vibeUuid), eq(grants.subject, existingGrant.subject)));
          }
        }
        if (nextGrants.size) {
          await transaction.insert(grants).values(
            [...nextGrants.values()].map((grant) => ({
              vibeUuid,
              subject: grant.subject,
              scopes: grant.scope,
            })),
          );
        }
      }
      await transaction.insert(vibeRevisions).values({
        vibeUuid,
        rev: vibeRecord.rev,
        actor: this.actor.subject,
        snapshot: snapshotVibe(vibeRecord, candidateGrants),
      });
      return vibeRecord;
    });
    return this.loadAggregate(vibeRecord);
  }

  async deleteVibe(vibeUuid: string): Promise<void> {
    await this.access.assertVibeOwner(vibeUuid);
    await this.db.transaction(async (transaction: DatabaseTransaction) => {
      await transaction.delete(vibes).where(eq(vibes.uuid, vibeUuid));
    });
  }

  async listMediaObjects(vibeUuid: string): Promise<MediaObjectAggregate[]> {
    await this.access.assertVibeScope(vibeUuid, GRANT_SCOPE.READ);
    const mediaObjectRows: { mediaObject: DbMediaObject }[] = await this.db
      .select({ mediaObject: mediaObjects })
      .from(vibeMediaObjects)
      .innerJoin(mediaObjects, eq(mediaObjects.uuid, vibeMediaObjects.mediaObjectUuid))
      .where(eq(vibeMediaObjects.vibeUuid, vibeUuid))
      .orderBy(asc(vibeMediaObjects.position), asc(vibeMediaObjects.addedAt));
    return Promise.all(
      mediaObjectRows.map(({ mediaObject }) => this.mediaObjectsService.loadAggregate(mediaObject)),
    );
  }

  async addMediaObjectRefs(
    vibeUuid: string,
    references: MediaObjectRefsRequest["objects"],
  ): Promise<void> {
    await this.access.assertVibeOwner(vibeUuid);
    if (this.actor.kind !== "user") throw new Error("Owner assertion did not narrow the actor");
    const mediaObjectUuids = references.map(uriId);
    const mediaObjectRecords = await this.mediaObjectsService.findByIds(mediaObjectUuids);
    const mediaObjectsByUuid = new Map(
      mediaObjectRecords.map((mediaObject) => [mediaObject.uuid, mediaObject]),
    );
    for (const mediaObjectUuid of mediaObjectUuids) {
      const mediaObjectRecord = mediaObjectsByUuid.get(mediaObjectUuid);
      if (!mediaObjectRecord) throw notFound("Object");
      if (mediaObjectRecord.ownerUuid !== this.actor.uuid) throw grantMissing("owner");
    }
    await this.db.transaction(async (transaction: DatabaseTransaction) => {
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

  async removeMediaObjectRefs(
    vibeUuid: string,
    references: MediaObjectRefsRequest["objects"],
  ): Promise<void> {
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

  private async loadAggregate(vibeRecord: DbVibe): Promise<VibeAggregate> {
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
      vibe: vibeRecord,
      grants: activeGrants,
      mediaObjectUuids: memberships.map((membership) => membership.uuid),
    };
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

function assertNoIntroducedPullSources(
  candidateSources: readonly string[] | undefined,
  existingSources: readonly string[],
): void {
  const candidates = candidateSources ?? [];
  if (new Set(candidates).size !== candidates.length) {
    throw new Problem(
      422,
      "schema_violation",
      "Pull configuration is invalid",
      "Configured source identifiers must be unique",
    );
  }

  const existing = new Set(existingSources);
  const introduced = candidates.filter((source) => !existing.has(source));
  if (introduced.length > 0) {
    throw new Problem(
      422,
      "import_review_invalid",
      "Import review required",
      "New ingestion sources can only be added by confirming a completed import preview",
    );
  }
}
