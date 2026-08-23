import type { Grant } from "@rnet/types";
import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "../db/index.ts";
import { grants } from "../db/models/grant.ts";
import { mediaObjectElements } from "../db/models/media-object-element.ts";
import { mediaElements } from "../db/models/media-element.ts";
import { mediaObjects } from "../db/models/media-object.ts";
import { vibeMediaObjects } from "../db/models/vibe-media-object.ts";
import { vibes } from "../db/models/vibe.ts";
import { grantMissing, notFound, Problem } from "../errors.ts";
import type { ServiceContext } from "./types.ts";

export type Scope = Grant["scope"][number];
export type DbVibe = typeof vibes.$inferSelect;

export class AccessService {
  private readonly db: Database;
  private readonly actor: ServiceContext["actor"];

  constructor({ db, actor }: ServiceContext) {
    this.db = db;
    this.actor = actor;
  }

  async assertAuthenticated(): Promise<void> {
    if (this.actor.kind === "public") {
      throw new Problem(401, "authentication_required", "Authentication required", "Sign in to continue");
    }
  }

  async assertVibeOwner(vibeUuid?: string): Promise<void> {
    await this.assertAuthenticated();
    if (this.actor.kind !== "user") throw grantMissing("owner");
    if (!vibeUuid) return;
    const [vibe] = await this.db.select({ ownerUuid: vibes.ownerUuid }).from(vibes).where(eq(vibes.uuid, vibeUuid));
    if (!vibe) throw notFound("Vibe");
    if (vibe.ownerUuid !== this.actor.uuid) throw grantMissing("owner");
  }

  async assertRecordOwner(ownerUuid: string): Promise<void> {
    await this.assertAuthenticated();
    if (this.actor.kind !== "user" || this.actor.uuid !== ownerUuid) throw grantMissing("owner");
  }

  async assertVibeScope(vibeUuid: string, scope: Scope): Promise<DbVibe> {
    const [vibe] = await this.db.select().from(vibes).where(eq(vibes.uuid, vibeUuid));
    if (!vibe) throw notFound("Vibe");
    if (this.actor.kind === "user" && this.actor.uuid === vibe.ownerUuid) return vibe;

    const [grant] = await this.db
      .select({ scopes: grants.scopes })
      .from(grants)
      .where(
        and(
          eq(grants.vibeUuid, vibeUuid),
          eq(grants.subject, this.actor.subject),
          isNull(grants.revokedAt),
        ),
      );
    if (!grant?.scopes.includes(scope)) throw grantMissing(scope);
    return vibe;
  }

  async canReadMediaObject(mediaObjectUuid: string): Promise<boolean> {
    const [mediaObjectRecord] = await this.db
      .select({ ownerUuid: mediaObjects.ownerUuid })
      .from(mediaObjects)
      .where(eq(mediaObjects.uuid, mediaObjectUuid));
    if (!mediaObjectRecord) return false;
    if (this.actor.kind === "user" && this.actor.uuid === mediaObjectRecord.ownerUuid) return true;
    const memberships = await this.db
      .select({ vibeUuid: vibeMediaObjects.vibeUuid })
      .from(vibeMediaObjects)
      .where(eq(vibeMediaObjects.mediaObjectUuid, mediaObjectUuid));
    for (const membership of memberships) {
      try {
        await this.assertVibeScope(membership.vibeUuid, "read");
        return true;
      } catch (error) {
        if (!(error instanceof Problem) || ![403, 404].includes(error.status)) throw error;
      }
    }
    return false;
  }

  async assertMediaObjectScope(mediaObjectUuid: string, scope: Scope): Promise<void> {
    const [mediaObjectRecord] = await this.db
      .select({ ownerUuid: mediaObjects.ownerUuid })
      .from(mediaObjects)
      .where(eq(mediaObjects.uuid, mediaObjectUuid));
    if (!mediaObjectRecord) throw notFound("Object");
    if (this.actor.kind === "user" && this.actor.uuid === mediaObjectRecord.ownerUuid) return;
    const memberships = await this.db
      .select({ vibeUuid: vibeMediaObjects.vibeUuid })
      .from(vibeMediaObjects)
      .where(eq(vibeMediaObjects.mediaObjectUuid, mediaObjectUuid));
    if (!memberships.length) throw grantMissing(scope);
    for (const membership of memberships) {
      try {
        await this.assertVibeScope(membership.vibeUuid, scope);
        return;
      } catch (error) {
        if (!(error instanceof Problem) || ![403, 404].includes(error.status)) throw error;
      }
    }
    throw grantMissing(scope);
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
      if (await this.canReadMediaObject(reference.mediaObjectUuid)) return true;
    }
    return false;
  }
}
