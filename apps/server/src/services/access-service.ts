import { and, asc, eq, isNull } from "drizzle-orm";

import type { Database, DatabaseTransaction } from "../db/index.ts";
import { grants, GRANT_SCOPE, type DbGrant, type GrantScope } from "../db/models/grant.ts";
import { mediaObjectElements } from "../db/models/media-object-element.ts";
import { mediaElements } from "../db/models/media-element.ts";
import { mediaObjects, type DbMediaObject } from "../db/models/media-object.ts";
import { vibeMediaObjects } from "../db/models/vibe-media-object.ts";
import { vibes, type DbVibe } from "../db/models/vibe.ts";
import { authenticationRequired, grantMissing, notFound, Problem } from "../errors.ts";
import type { ServiceContext } from "./types.ts";

export type Scope = GrantScope;

export class AccessService {
  private readonly db: Database;
  private readonly actor: ServiceContext["actor"];

  constructor({ db, actor }: ServiceContext) {
    this.db = db;
    this.actor = actor;
  }

  async assertAuthenticated(): Promise<void> {
    if (this.actor.kind === "public") throw authenticationRequired();
  }

  async assertVibeOwner(vibeUuid?: string): Promise<void> {
    await this.assertAuthenticated();
    if (this.actor.kind !== "user") throw grantMissing("owner");
    if (!vibeUuid) return;
    this.assertOwner(await this.findVibe(this.db, vibeUuid));
  }

  async assertRecordOwner(ownerUuid: string): Promise<void> {
    await this.assertAuthenticated();
    if (this.actor.kind !== "user" || this.actor.uuid !== ownerUuid) throw grantMissing("owner");
  }

  async assertVibeScope(vibeUuid: string, scope: Scope): Promise<DbVibe> {
    return this.assertVibeScopeWithDatabase(this.db, vibeUuid, scope);
  }

  async lockVibeOwnerForWrite({
    transaction,
    vibeUuid,
  }: {
    transaction: DatabaseTransaction;
    vibeUuid: string;
  }): Promise<DbVibe> {
    const vibe = await this.findVibe(transaction, vibeUuid);
    this.assertOwner(vibe);

    const lockedVibe = await this.lockVibe(transaction, vibeUuid, "update");
    this.assertOwner(lockedVibe);
    return lockedVibe;
  }

  async lockVibeScopeForWrite({
    transaction,
    vibeUuid,
    expectedOwnerUuid,
    scope,
  }: {
    transaction: DatabaseTransaction;
    vibeUuid: string;
    expectedOwnerUuid: string;
    scope: Scope;
  }): Promise<DbVibe> {
    const vibe = await this.assertVibeScopeWithDatabase(transaction, vibeUuid, scope);
    this.assertExpectedOwner(vibe, expectedOwnerUuid);

    const lockedVibe = await this.lockVibe(transaction, vibeUuid, "share");
    this.assertExpectedOwner(lockedVibe, expectedOwnerUuid);
    await this.assertVibeScopeForRecord(transaction, lockedVibe, scope, true);
    return lockedVibe;
  }

  async lockMediaObjectScopeForWrite({
    transaction,
    mediaObjectUuid,
    scope,
  }: {
    transaction: DatabaseTransaction;
    mediaObjectUuid: string;
    scope: Scope;
  }): Promise<DbMediaObject> {
    const mediaObjectRecord = await this.findMediaObject(transaction, mediaObjectUuid);
    if (this.actor.kind === "user" && this.actor.uuid === mediaObjectRecord.ownerUuid) {
      const lockedMediaObject = await this.lockMediaObjectForWrite(transaction, mediaObjectUuid);
      if (lockedMediaObject.ownerUuid !== mediaObjectRecord.ownerUuid) throw grantMissing("owner");
      return lockedMediaObject;
    }

    const vibeUuid = await this.findAuthorizedMediaObjectVibe(
      transaction,
      mediaObjectRecord,
      scope,
    );
    await this.lockVibeScopeForWrite({
      transaction,
      vibeUuid,
      expectedOwnerUuid: mediaObjectRecord.ownerUuid,
      scope,
    });
    const [lockedMembership] = await transaction
      .select({ vibeUuid: vibeMediaObjects.vibeUuid })
      .from(vibeMediaObjects)
      .where(
        and(
          eq(vibeMediaObjects.vibeUuid, vibeUuid),
          eq(vibeMediaObjects.mediaObjectUuid, mediaObjectUuid),
        ),
      )
      .for("share");
    if (!lockedMembership) throw grantMissing(scope);

    const lockedMediaObject = await this.lockMediaObjectForWrite(transaction, mediaObjectUuid);
    if (lockedMediaObject.ownerUuid !== mediaObjectRecord.ownerUuid) throw grantMissing("owner");
    return lockedMediaObject;
  }

  async assertMediaObjectScope(
    mediaObject: string | DbMediaObject,
    scope: Scope,
  ): Promise<DbMediaObject> {
    const mediaObjectRecord =
      typeof mediaObject === "string"
        ? await this.findMediaObject(this.db, mediaObject)
        : mediaObject;
    if (this.actor.kind === "user" && this.actor.uuid === mediaObjectRecord.ownerUuid) {
      return mediaObjectRecord;
    }
    await this.findAuthorizedMediaObjectVibe(this.db, mediaObjectRecord, scope);
    return mediaObjectRecord;
  }

  async canReadMediaElement(mediaElementUuid: string): Promise<boolean> {
    const [mediaElementRecord] = await this.db
      .select({ ownerUuid: mediaElements.ownerUuid })
      .from(mediaElements)
      .where(eq(mediaElements.uuid, mediaElementUuid));
    if (!mediaElementRecord) return false;
    if (this.actor.kind === "user" && this.actor.uuid === mediaElementRecord.ownerUuid) return true;
    const references = await this.db
      .select({ mediaObjectUuid: mediaObjectElements.mediaObjectUuid })
      .from(mediaObjectElements)
      .where(eq(mediaObjectElements.mediaElementUuid, mediaElementUuid));
    for (const reference of references) {
      try {
        await this.assertMediaObjectScope(reference.mediaObjectUuid, GRANT_SCOPE.READ);
        return true;
      } catch (error) {
        if (!(error instanceof Problem) || ![403, 404].includes(error.status)) throw error;
      }
    }
    return false;
  }

  private async assertVibeScopeWithDatabase(
    database: Database | DatabaseTransaction,
    vibeUuid: string,
    scope: Scope,
  ): Promise<DbVibe> {
    const vibe = await this.findVibe(database, vibeUuid);
    await this.assertVibeScopeForRecord(database, vibe, scope, false);
    return vibe;
  }

  private async assertVibeScopeForRecord(
    database: Database | DatabaseTransaction,
    vibe: DbVibe,
    scope: Scope,
    lockGrant: boolean,
  ): Promise<void> {
    if (this.actor.kind === "user" && this.actor.uuid === vibe.ownerUuid) return;

    const query = database
      .select({ scopes: grants.scopes })
      .from(grants)
      .where(
        and(
          eq(grants.vibeUuid, vibe.uuid),
          eq(grants.subject, this.actor.subject),
          isNull(grants.revokedAt),
        ),
      );
    const grantRows: Pick<DbGrant, "scopes">[] = lockGrant ? await query.for("share") : await query;
    const [grant] = grantRows;
    if (!grant?.scopes.includes(scope)) throw grantMissing(scope);
  }

  private async findAuthorizedMediaObjectVibe(
    database: Database | DatabaseTransaction,
    mediaObject: DbMediaObject,
    scope: Scope,
  ): Promise<string> {
    const memberships: { vibeUuid: string }[] = await database
      .select({ vibeUuid: vibeMediaObjects.vibeUuid })
      .from(vibeMediaObjects)
      .where(eq(vibeMediaObjects.mediaObjectUuid, mediaObject.uuid))
      .orderBy(asc(vibeMediaObjects.vibeUuid));
    for (const { vibeUuid } of memberships) {
      try {
        const vibe = await this.assertVibeScopeWithDatabase(database, vibeUuid, scope);
        if (vibe.ownerUuid !== mediaObject.ownerUuid) continue;
        return vibeUuid;
      } catch (error) {
        if (!(error instanceof Problem) || ![403, 404].includes(error.status)) throw error;
      }
    }
    throw grantMissing(scope);
  }

  private async findVibe(
    database: Database | DatabaseTransaction,
    vibeUuid: string,
  ): Promise<DbVibe> {
    const vibeRows: DbVibe[] = await database.select().from(vibes).where(eq(vibes.uuid, vibeUuid));
    const [vibe] = vibeRows;
    if (!vibe) throw notFound("Vibe");
    return vibe;
  }

  private async findMediaObject(
    database: Database | DatabaseTransaction,
    mediaObjectUuid: string,
  ): Promise<DbMediaObject> {
    const mediaObjectRows: DbMediaObject[] = await database
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.uuid, mediaObjectUuid));
    const [mediaObject] = mediaObjectRows;
    if (!mediaObject) throw notFound("Object");
    return mediaObject;
  }

  private assertOwner(vibe: DbVibe): void {
    if (this.actor.kind !== "user" || this.actor.uuid !== vibe.ownerUuid) {
      throw grantMissing("owner");
    }
  }

  private assertExpectedOwner(vibe: DbVibe, expectedOwnerUuid: string): void {
    if (vibe.ownerUuid !== expectedOwnerUuid) throw grantMissing("owner");
  }

  private async lockVibe(
    transaction: DatabaseTransaction,
    vibeUuid: string,
    lock: "share" | "update",
  ): Promise<DbVibe> {
    const vibeRows: DbVibe[] = await transaction
      .select()
      .from(vibes)
      .where(eq(vibes.uuid, vibeUuid))
      .for(lock);
    const [vibe] = vibeRows;
    if (!vibe) throw notFound("Vibe");
    return vibe;
  }

  private async lockMediaObjectForWrite(
    transaction: DatabaseTransaction,
    mediaObjectUuid: string,
  ): Promise<DbMediaObject> {
    const mediaObjectRows: DbMediaObject[] = await transaction
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.uuid, mediaObjectUuid))
      .for("update");
    const [mediaObject] = mediaObjectRows;
    if (!mediaObject) throw notFound("Object");
    return mediaObject;
  }
}
